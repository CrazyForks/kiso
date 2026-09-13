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

legs = sorted(glob.glob(os.path.join(ARCHIVE, "**", "kiso-home", "sessions", "*.jsonl"), recursive=True))
changed, with_unknown, total_reqs, total_unknown = [], [], 0, 0
for p in legs:
    m = old_and_new(p)
    total_reqs += m["reqs"]; total_unknown += m["unknown"]
    if m["unknown"]:
        with_unknown.append((p, m))
    if abs(m["old_cost"] - m["new_cost"]) > 1e-9:
        changed.append((p, m))

print(f"legs scanned            : {len(legs)}")
print(f"usage records           : {total_reqs}")
print(f"records with UNKNOWN    : {total_unknown}")
print(f"legs containing unknown : {len(with_unknown)}")
print(f"legs whose cost CHANGES : {len(changed)}")
print()
if changed:
    print("Every changed leg must be one that contains unknown usage:")
    bad = [p for p, m in changed if m["unknown"] == 0]
    print(f"  changed WITHOUT unknown usage: {len(bad)}   <- must be 0")
    for p, m in changed[:5]:
        print(f"  {os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(p))))}: "
              f"old={m['old_cost']:.0f} new={m['new_cost']:.0f} unknown={m['unknown']}/{m['reqs']}")
else:
    print("No historical number moves: every leg IN THIS ARCHIVE has complete")
    print("usage, so the fix restates nothing already published.")
    print()
    print("WHAT THIS DOES NOT SHOW. It is a compatibility result over one")
    print("archive, not a statement about the world: it does not establish")
    print("that the provider has always reported completely, that the defect")
    print("never fired anywhere, or anything at all about pi's and Claude")
    print("Code's real records — whose formats are not ours and which this")
    print("archive does not contain in their native shape.")
