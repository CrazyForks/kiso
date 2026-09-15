#!/usr/bin/env python3
"""Validate the metering fix against the ARCHIVED RAW USAGE (freeze item 1).

Two questions, both read-only:
  1. Does the fix restate any historical number? For a leg whose usage is
     complete it MUST NOT — otherwise past results change silently.
  2. How many archived requests carry usage nobody reported? That is the
     question the checkout could not answer.
"""
import json, os, sys, glob

ARCHIVE = sys.argv[1]

def old_and_new(path):
    """Both accountings over one session log, in one pass."""
    o_fresh = o_cache = o_out = o_reqs = 0          # the pre-fix reading
    n_fresh = n_cache = n_out = n_reqs = n_unk = 0  # unknown is not zero
    for line in open(path, errors="ignore"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        e = r.get("event")
        if not isinstance(e, dict) or e.get("type") != "usage":
            continue
        i, ca, o = e.get("inputTokens"), e.get("cacheRead"), e.get("outputTokens")
        # old: missing becomes zero, and the request is counted
        oi, oca, oo = i or 0, ca or 0, o or 0
        o_reqs += 1; o_fresh += oi - oca; o_cache += oca; o_out += oo
        # new: unknown is its own state
        n_reqs += 1
        if e.get("known") is False or i is None or ca is None or o is None:
            n_unk += 1
            continue
        n_fresh += i - ca; n_cache += ca; n_out += o
    ce = lambda f, c, ou: f + 0.02 * c + 4 * ou
    return dict(old_cost=ce(o_fresh, o_cache, o_out), new_cost=ce(n_fresh, n_cache, n_out),
                reqs=o_reqs, unknown=n_unk)

# F33-3: BOTH surfaces. The first version globbed only the plain session
# logs, so it could not reproduce on its own the claim that "both paths are
# complete" — the sidecar path, which is the one the extractors read first,
# was never opened.
logs = sorted(glob.glob(os.path.join(ARCHIVE, "**", "kiso-home", "sessions", "*.jsonl"), recursive=True))
traces = sorted(glob.glob(os.path.join(ARCHIVE, "**", "kiso-home", "sessions", "traces", "*.jsonl"), recursive=True))
logs = [p for p in logs if p not in set(traces)]

trace_reqs = trace_unknown = trace_undecidable = 0
for p in traces:
    for line in open(p):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("kind") != "request":
            continue
        trace_reqs += 1
        # F33-1 again, from the other side: a v5 record says; an older one
        # cannot, and "cannot say" is not "complete".
        if r.get("usageKnown") is False:
            trace_unknown += 1
        elif "usageKnown" not in r:
            trace_undecidable += 1

changed, with_unknown, total_reqs, total_unknown = [], [], 0, 0
for p in logs:
    m = old_and_new(p)
    total_reqs += m["reqs"]; total_unknown += m["unknown"]
    if m["unknown"]:
        with_unknown.append((p, m))
    if abs(m["old_cost"] - m["new_cost"]) > 1e-9:
        changed.append((p, m))

print(f"plain session logs      : {len(logs)}")
print(f"  usage records         : {total_reqs}")
print(f"  records with UNKNOWN  : {total_unknown}")
print(f"  logs containing one   : {len(with_unknown)}")
print(f"trace sidecars          : {len(traces)}")
print(f"  request records       : {trace_reqs}")
print(f"  usageKnown = false    : {trace_unknown}")
print(f"  no usageKnown (pre-v5): {trace_undecidable}")
print()

# THE TWO VERDICTS ARE SEPARATE. The first version printed "every leg has
# complete usage" whenever no cost moved — but a record that is all null
# under `known: false` contributes zero to BOTH the old algorithm and the
# new one, so an archive full of unknowns moves no cost at all. "Nothing
# was restated" and "nothing was missing" are different questions and the
# report now answers them one at a time.
complete = total_unknown == 0 and trace_unknown == 0 and trace_undecidable == 0
print("VERDICT 1 — completeness (is any usage unknown or undecidable?)")
if complete:
    print("  COMPLETE: every record in this archive states its usage.")
else:
    print(f"  NOT COMPLETE: {total_unknown} unknown in plain logs, "
          f"{trace_unknown} unknown and {trace_undecidable} undecidable in sidecars.")
print()
print("VERDICT 2 — historical compatibility (does the fix move a published number?)")
if changed:
    print("Every changed leg must be one that contains unknown usage:")
    bad = [p for p, m in changed if m["unknown"] == 0]
    print(f"  changed WITHOUT unknown usage: {len(bad)}   <- must be 0")
    for p, m in changed[:5]:
        print(f"  {os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(p))))}: "
              f"old={m['old_cost']:.0f} new={m['new_cost']:.0f} unknown={m['unknown']}/{m['reqs']}")
else:
    print("  NO NUMBER MOVES: the old and new algorithms agree on every leg")
    print("  in this archive, so the fix restates nothing already published.")
    print("  This says NOTHING about completeness — see verdict 1 above.")
    print()
    print("WHAT THIS DOES NOT SHOW. It is a compatibility result over one")
    print("archive, not a statement about the world: it does not establish")
    print("that the provider has always reported completely, that the defect")
    print("never fired anywhere, or anything at all about pi's and Claude")
    print("Code's real records — whose formats are not ours and which this")
    print("archive does not contain in their native shape.")
