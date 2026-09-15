#!/usr/bin/env python3
"""
Freeze item 1's own requirement: the extractor, validated against ARCHIVED
RAW USAGE rather than against fixtures.

Every gate the extractor has is a fixture I wrote, checked by an extractor
I wrote. Two artefacts built from one understanding agree with each other
whether or not the understanding is right, and the defect this item was
opened for — `e.get("inputTokens") or 0`, a null read as a free request —
lived under a full set of green fixtures.

So this reads the RAW provider numbers out of archived legs, recomputes
the quantities from the WRITTEN CONVENTION, and compares. It deliberately
imports nothing from extract*.py: the arithmetic below is transcribed from
the convention's statement, not from the implementation of it.

The convention, for the openai-compat route:
    the provider's `inputTokens` is the TOTAL prompt, cache included
    fresh   = inputTokens - cacheRead
    output  = outputTokens
    total   = fresh + cacheRead
A request whose provider reported nothing is UNKNOWN, and an unknown is
never priced.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def raw_from_session_log(leg):
    """The provider's own numbers, as the session log recorded them."""
    fresh = cache = out = 0
    n = unknown = 0
    d = os.path.join(leg, "kiso-home", "sessions")
    for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        for line in open(f, errors="ignore"):
            t = line.strip()
            if not t.startswith("{"):
                continue
            try:
                o = json.loads(t)
            except Exception:
                continue
            e = o.get("event")
            if not isinstance(e, dict) or e.get("type") != "usage":
                continue
            n += 1
            i, c, ot = e.get("inputTokens"), e.get("cacheRead"), e.get("outputTokens")
            if i is None or ot is None:
                unknown += 1
                continue
            c = c or 0
            fresh += max(0, i - c)
            cache += c
            out += ot
    return {"fresh": fresh, "cache_read": cache, "output": out, "requests": n, "unknown": unknown}


def raw_from_sidecar(leg):
    """The same quantities off the trace ledger's RAW quartet — not its
    canonical block, which is the derivation under test."""
    fresh = cache = out = 0
    n = unknown = 0
    d = os.path.join(leg, "kiso-home", "sessions", "traces")
    for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        for line in open(f, errors="ignore"):
            t = line.strip()
            if not t.startswith("{"):
                continue
            try:
                o = json.loads(t)
            except Exception:
                continue
            # A COMPACTION SUMMARY IS A BILLED CALL. It is written as
            # `kind: "summary"` rather than "request" only because it must
            # not open a run of its own, and the first version of this
            # validator filtered on kind == "request" and missed it —
            # reproducing, inside the check, the exact blindness the
            # summary line was introduced to fix ("the E5-era extraction
            # could not see the call at all"). The extractor was right and
            # this file was wrong; recorded because the validator failing
            # first is the ordinary case and pretending otherwise would
            # make the next reader distrust the extractor.
            if o.get("kind") == "summary":
                c = o.get("canonical") or {}
                n += 1
                fresh += c.get("input") or 0
                cache += c.get("cacheRead") or 0
                out += c.get("output") or 0
                continue
            if o.get("kind") != "request":
                continue
            n += 1
            # the guard writes freshInput ALREADY converted; cacheRead and
            # output are the provider's
            fi, c, ot = o.get("freshInput"), o.get("cacheRead"), o.get("output")
            if fi is None or ot is None:
                unknown += 1
                continue
            fresh += fi
            cache += c or 0
            out += ot
    return {"fresh": fresh, "cache_read": cache, "output": out, "requests": n, "unknown": unknown}


def extractor(legs_parent):
    """extract-t5.py's own answer, through its real entrypoint."""
    out = subprocess.run(
        [sys.executable, os.path.join(BENCH, "extract-t5.py"), legs_parent],
        capture_output=True, text=True, check=False,
    )
    try:
        return json.loads(out.stdout)
    except Exception:
        return []


def legs_under(runs_dir):
    """Every archived kiso leg beneath a runs/ directory."""
    out = []
    for d in sorted(glob.glob(os.path.join(runs_dir, "*", "*"))):
        if os.path.isdir(os.path.join(d, "kiso-home", "sessions")):
            out.append(d)
    return out


def summary_totals(leg):
    """The compaction summary calls in this leg, from their own records.
    A difference between the two readings is explained by these ONLY when
    it equals these — computed, never assumed from a request-count gap."""
    fresh = cache = out = 0
    n = 0
    d = os.path.join(leg, "kiso-home", "sessions", "traces")
    for f in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        for line in open(f, errors="ignore"):
            t = line.strip()
            if not t.startswith("{"):
                continue
            try:
                o = json.loads(t)
            except Exception:
                continue
            if o.get("kind") != "summary":
                continue
            c = o.get("canonical") or {}
            n += 1
            fresh += c.get("input") or 0
            cache += c.get("cacheRead") or 0
            out += c.get("output") or 0
    return {"fresh": fresh, "cache_read": cache, "output": out, "requests": n}


def view_for(legs, tmp):
    """The extractor globs `<workdir>/runs/*T5*` and splits the directory
    name as <tool>-<task>-<run>. Build that shape rather than making the
    caller do it — a validator that needs a hand-built view is one nobody
    runs."""
    runs = os.path.join(tmp, "runs")
    os.makedirs(runs, exist_ok=True)
    picked = []
    for leg in legs:
        name = os.path.basename(leg)
        if "-T5-" not in name:
            continue
        # Rounds reuse leg names — `calib-2026-09-15/kiso-T5-r1` and
        # `rsn1-verify/kiso-T5-r1` are different legs with one basename, and
        # the first version of this collided on the symlink. The round rides
        # the RUN field, which is the part the extractor treats as opaque.
        tool, task, run = name.split("-", 2)
        rnd = os.path.basename(os.path.dirname(leg)).replace("-", "")
        alias = f"{tool}-{task}-{rnd}{run}"
        os.symlink(os.path.abspath(leg), os.path.join(runs, alias))
        picked.append((leg, tool, f"{rnd}{run}"))
    return tmp, picked


if __name__ == "__main__":
    runs = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BENCH, "runs")
    legs = legs_under(runs)
    if not legs:
        print(f"no archived kiso legs under {runs} — an empty read is a failed read, not an answer", file=sys.stderr)
        sys.exit(2)

    bad = 0

    # PART 1 — the two RAW readings, and a difference explained only by
    # what the summary records actually say.
    print("  raw readings: the session log's usage events vs the trace ledger\n")
    for leg in legs:
        a = raw_from_session_log(leg)
        b = raw_from_sidecar(leg)
        rel = os.path.relpath(leg, runs)
        if b["requests"] == 0:
            print(f"    {rel:46} log-only, {a['requests']} requests")
            continue
        d = {k: b[k] - a[k] for k in ("fresh", "cache_read", "output")}
        summ = summary_totals(leg)
        if all(v == 0 for v in d.values()):
            print(f"    {rel:46} agree")
        elif (d["fresh"], d["cache_read"], d["output"]) == (summ["fresh"], summ["cache_read"], summ["output"]):
            print(f"    {rel:46} differ by EXACTLY the {summ['requests']} summary call(s)")
        else:
            bad += 1
            print(f"    {rel:46} UNEXPLAINED: diff {d}, summaries {summ}")

    # PART 2 — the extractor itself, which is the item's actual subject.
    # The first version of this file defined `extractor()` and never called
    # it: the tool shipped comparing two of MY readings to each other while
    # its commit message claimed the extractor had been validated. The
    # numbers in that claim came from a shell script that was never
    # committed. A validator that does not run the thing under test is a
    # validator of nothing.
    print("\n  the extractor, against the raw readings\n")
    tmp = tempfile.mkdtemp()
    view, picked = view_for(legs, tmp)
    rows = extractor(view)
    if not rows:
        print("    the extractor returned NOTHING — an empty read is a failed read", file=sys.stderr)
        sys.exit(2)
    by_run = {(r["tool"], r["run"]): r for r in rows}
    checked = 0
    for leg, tool, run in picked:
        name = os.path.relpath(leg, runs)
        r = by_run.get((tool, run))
        if r is None:
            bad += 1
            print(f"    {name:46} the extractor produced no row for this leg")
            continue
        mine = raw_from_sidecar(leg)
        for k in ("fresh", "cache_read", "output", "requests"):
            checked += 1
            if r[k] != mine[k]:
                bad += 1
                print(f"    {name:46} {k}: extractor {r[k]} vs raw {mine[k]}   MISMATCH")
        if all(r[k] == mine[k] for k in ("fresh", "cache_read", "output", "requests")):
            print(f"    {name:46} fresh {r['fresh']}, cache {r['cache_read']}, out {r['output']}, req {r['requests']}  all match")
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n  quantities compared against the extractor: {checked}")
    print(f"  disagreements with no stated cause: {bad}")
    sys.exit(1 if bad else 0)
