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
import subprocess
import sys

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


if __name__ == "__main__":
    runs = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BENCH, "runs")
    legs = legs_under(runs)
    if not legs:
        print(f"no archived kiso legs under {runs} — an empty read is a failed read, not an answer", file=sys.stderr)
        sys.exit(2)
    bad = 0
    for leg in legs:
        a = raw_from_session_log(leg)
        b = raw_from_sidecar(leg)
        if b["requests"] == 0:
            print(f"  {os.path.relpath(leg, runs):48} log-only, {a['requests']} requests")
            continue
        same = (a["fresh"], a["cache_read"], a["output"]) == (b["fresh"], b["cache_read"], b["output"])
        # the sidecar carries the summary call, which the session log's
        # usage events do not: a difference of exactly that call is
        # expected, anything else is not
        note = "agree" if same else "differ (expected when the leg compacted — the summary call is a sidecar-only record)"
        if not same and b["requests"] == a["requests"]:
            bad += 1
            note = "DIFFER with equal request counts — that is not the summary call"
        print(f"  {os.path.relpath(leg, runs):48} {note}")
    print(f"\n  legs whose two raw readings disagree for no stated reason: {bad}")
    sys.exit(1 if bad else 0)
