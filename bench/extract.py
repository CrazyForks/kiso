#!/usr/bin/env python3
"""Extract per-run metrics from each tool's own durable records.

ACCOUNTING (the 0.1.23 fresh-mystery round fixed a mislabeling here; E2
1.3.0 switched kiso to the CANONICAL schema — T7): the three tools report
"input" differently, and the extractor reduces EVERY line to the uniform
primitives fresh / cache_read / output before summing —
  kiso (1.3.0+): the per-request usage rides the TRACE SIDECAR
          (sessions/traces/<sid>.jsonl). The canonical block's input is
          FRESH-ONLY on BOTH routes (the pinned sentence); a v1 sidecar
          (pre-1.3.0) has no canonical block — its freshInput IS the
          guard's route-derived fresh (read as defaults, never a crash,
          R1d-1). A session with NO sidecar (the writer soft-failed)
          falls back to its session-log raw events: the legacy
          openai-compat derivation fresh = inputTokens − cache_read,
          captured once per line.
  pi:     usage.input = fresh-only (its cache read is reported separately)
          → fresh = input, total = input + cache_read.
  claude: input_tokens = fresh-only (Anthropic convention: cache reads are
          separate) → fresh = input, total = input + cache_read.
The output rows carry the uniform fields: input = fresh, fresh, total =
fresh + cache_read, cost_weighted = fresh + 0.1 × cache_read (0.1 is
DeepSeek's cache-hit price ratio,
https://api-docs.deepseek.com/quick_start/pricing).

METRIC v2 (launch-bench protocol revision 4 §7): `cost_equivalent` =
F + 0.02·H + 4·O — fresh, cache HIT at its own ratio, and OUTPUT at the
ratio it actually costs. It rides BESIDE cost_weighted rather than
replacing it: every row already published, and every comparison already
adjudicated, was judged on v1, and a metric that changes under a
comparison is not a metric. v1 and its consumers are untouched here.

Why output enters at all: v1 counts only what goes IN. A change that makes
the agent write more to say the same thing is free under v1 and is not free
on the bill. The prompt round that motivated this had one arm asking a
question instead of running a command — cheaper in, and v1 could not see
the difference. The v8-and-older kiso
tables kept the openai-compat raw shape (input = total) — on healthy data
the numbers are identical; the canonical switch fixes the >100% disease
(cache_read > inputTokens: the old fresh went NEGATIVE).

first_prompt = the first request's TRUE total (fresh + cache_read), the
pi shape. The v8-and-older value was inputTokens + cache_read — the
DeepSeek raw already includes the cache hit, so the cache was counted
twice; no README table ever rendered it, but the fix is pinned in
tests/test_extract.py so it stays honest.
"""
import json, os, sys, glob

def unknown_in_session_log(path):
    """How many requests in a PLAIN session log had no reported usage.

    Astra F33-1: the trace writer initialises the quartet to zero under an
    explicit "0 = unknown" convention and settles it only when the provider
    reports. A pre-v5 sidecar therefore cannot tell an unmeasured request
    from a free one, and reading it alone turned usage_incomplete from true
    to false the moment a sidecar was added to a session that had one. The
    plain log kept the flag (`known: false`, null fields), so for those
    generations it is the surviving source of known-ness.
    """
    n = 0
    if not os.path.exists(path):
        return None                                # nothing survives to consult
    for line in open(path):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        e = r.get("event")
        if not isinstance(e, dict) or e.get("type") != "usage":
            continue
        i, ca, o = e.get("inputTokens"), e.get("cacheRead"), e.get("outputTokens")
        if e.get("known") is False or i is None or ca is None or o is None:
            n += 1
    return n


def kiso(work):
    # The traced set: sessions whose ledger the trace dir covers — their
    # session logs are NOT also read (no double counting); untraced
    # sessions fall back to the session-log path.
    sessions = f"{work}/kiso-home/sessions"
    traced = set()
    for p in glob.glob(f"{sessions}/traces/*.jsonl"):
        traced.add(os.path.basename(p)[:-6])
    files = sorted(glob.glob(f"{sessions}/traces/*.jsonl") +
                   [p for p in glob.glob(f"{sessions}/*.jsonl")
                    if os.path.basename(p)[:-6] not in traced])
    fresh = out = cache = reqs = unknown = 0
    pre_v5_sessions = set()
    first = None
    for f in files:
        for line in open(f):
            r = json.loads(line)
            if "canonical" in r:                      # v2 ledger: the canonical block
                # F33-1: a v5 record SAYS whether the provider reported.
                # Before v5 the record could not say, and the four zeros of
                # an unmeasured request are the four zeros of a free one —
                # so the sibling plain log is consulted below instead.
                if r.get("usageKnown") is False:
                    reqs += 1
                    unknown += 1
                    continue
                if r.get("kind") == "request" and "usageKnown" not in r:
                    pre_v5_sessions.add(os.path.basename(f)[:-6])
                c = r["canonical"]
                fr, ca, o = c["input"], c["cacheRead"], c["output"]
            elif r.get("kind") == "request":          # v1 ledger: the guard's fresh
                if r.get("usageKnown") is False:
                    reqs += 1
                    unknown += 1
                    continue
                if "usageKnown" not in r:
                    pre_v5_sessions.add(os.path.basename(f)[:-6])
                fr, ca, o = r["freshInput"], r["cacheRead"], r["output"]
            else:
                e = r.get("event")
                if not isinstance(e, dict) or e.get("type") != "usage":
                    continue                          # header/run_end/crash, non-usage
                # UNKNOWN IS NOT ZERO. The runtime states this and keeps it:
                # `known: false` means the provider reported no usage and the
                # token fields are null, "never faked as zero" (Area 6,
                # packages/core/src/protocol/events.ts). Reading them as
                # `or 0` destroyed exactly that distinction and never once
                # consulted the flag set for this purpose — so a request whose
                # usage nobody reported counted as a request costing NOTHING,
                # and the arm with the least observable provider measured as
                # the cheapest. In a comparison that rewards being unmeasurable.
                i, ca, o = e.get("inputTokens"), e.get("cacheRead"), e.get("outputTokens")
                if e.get("known") is False or i is None or ca is None or o is None:
                    reqs += 1
                    unknown += 1
                    continue
                fr = i - ca                           # legacy session log: the 0.1.23 derivation
            reqs += 1
            fresh += fr; cache += ca; out += o
            if first is None: first = fr + ca
    # F33-1: for every traced session whose records predate v5, the sidecar
    # cannot say; its sibling plain log can. A session whose plain log is
    # gone is UNDECIDABLE, and undecidable is reported as incomplete — never
    # as complete, which is the direction that flatters whoever is measured.
    undecidable = 0
    for sid in sorted(pre_v5_sessions):
        n = unknown_in_session_log(f"{sessions}/{sid}.jsonl")
        if n is None:
            undecidable += 1
        else:
            unknown += n
    return dict(input=fresh, cache_read=cache, output=out, requests=reqs,
                fresh=fresh, total=fresh + cache, cost_weighted=fresh + 0.1 * cache,
                cost_equivalent=fresh + 0.02 * cache + 4 * out,
                # The refusal handles: a caller comparing arms can see that a
                # leg's usage is incomplete instead of reading it as cheap.
                unknown_requests=unknown,
                usage_incomplete=unknown > 0 or undecidable > 0,
                undecidable_sessions=undecidable,
                first_prompt=first)

def completion_role(ev):
    """What a pi `message_end` IS: "assistant", another role, or unknown.

    F33-R2: pi emits message_end for user messages and tool results too —
    the real calibration archive holds 8 user, 32 assistant and 24
    toolResult — and counting all of them doubled a fully measured
    32-request leg to 64 with 32 "unknown".

    A MISSING role is its own answer and neither of the two convenient
    ones. Calling it assistant re-admits the events R2 exists to exclude;
    dropping it makes a request vanish, which is the same error one level
    earlier. So it is counted as a completion whose usage is UNKNOWN: the
    leg goes incomplete and says so, rather than being silently inflated or
    silently shrunk.

    The request COUNTER shares this predicate. Two definitions of "a
    request" is how a leg's count and its ledger stop agreeing.
    """
    msg = ev.get("message")
    if not isinstance(msg, dict):
        return None
    role = msg.get("role")
    return role if isinstance(role, str) and role != "" else None


def pi(work):
    # pi --mode json emits JSONL: one event per line; usage lives on
    # assistant "message"/"message_end" events' message.usage.
    inp = out = cache = reqs = unknown = 0
    first = None
    for line in open(f"{work}/stdout.log"):
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(ev, dict) or ev.get("type") != "message_end":
            continue
        # F33-R2: only an ASSISTANT completion is a model request. Native pi
        # emits message_end for user messages and tool results too — the real
        # calibration archive holds 8 user, 32 assistant and 24 toolResult —
        # and counting all of them doubled a fully measured 32-request leg to
        # 64 with 32 "unknown", rejecting a valid comparator.
        #
        # The role is checked BEFORE the usage, and the usage after: F33-2's
        # rule stands (a completion nobody measured is still a completion),
        # it just applies to completions rather than to every message.
        _role = completion_role(ev)
        if _role is not None and _role != "assistant":
            continue
        reqs += 1
        if _role is None:
            unknown += 1
            continue
        msg = ev.get("message")
        u = (msg or {}).get("usage") if isinstance(msg, dict) else None
        # UNKNOWN IS NOT ZERO — and this matters more here than for kiso:
        # pi's trace format is not ours. A field it stops emitting would
        # make this arm measure as free in the comparison a claim rests on.
        i, ca, o = (u.get("input"), u.get("cacheRead"), u.get("output")) if isinstance(u, dict) else (None, None, None)
        if i is None or ca is None or o is None:
            unknown += 1
            continue
        inp += i; cache += ca; out += o
        if first is None: first = i + ca
    return dict(input=inp, cache_read=cache, output=out, requests=reqs,
                fresh=inp, total=inp + cache, cost_weighted=inp + 0.1 * cache,
                cost_equivalent=inp + 0.02 * cache + 4 * out,
                unknown_requests=unknown, usage_incomplete=unknown > 0,
                undecidable_sessions=0,
                first_prompt=first)

def claude(work):
    # CC may print warning lines around the result JSON — and since 2.1.233
    # the warning itself carries a JSON fragment (`[claude-code:...] {...}`),
    # so "parse from the first {" breaks. Parse per line; keep the LAST
    # object that carries a usage block.
    d = None
    for line in open(f"{work}/stdout.log"):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if "usage" in o:
            d = o
    if d is None:
        raise ValueError("no usage JSON line in stdout.log")
    u = d.get("usage", {})
    # UNKNOWN IS NOT ZERO. `u.get(..., 0)` turned an absent field — or an
    # absent usage block entirely — into a free run.
    i, ca, o = u.get("input_tokens"), u.get("cache_read_input_tokens"), u.get("output_tokens")
    unknown = 1 if (i is None or ca is None or o is None) else 0
    inp = i or 0
    cache = ca or 0
    out = o or 0
    return dict(input=inp, cache_read=cache,
                output=out,
                requests=d.get("num_turns", 0),
                fresh=inp, total=inp + cache, cost_weighted=inp + 0.1 * cache,
                cost_equivalent=inp + 0.02 * cache + 4 * out,
                unknown_requests=unknown, usage_incomplete=unknown > 0,
                first_prompt=None)

def main(workdir):
    rows = []
    for work in sorted(glob.glob(workdir + "/runs/*")):
        name = os.path.basename(work)
        if "T5" in name:
            continue  # T5 is the long-session scenario — extract-t5.py's job
        if name.count("-") < 2:
            continue  # not a <tool>-<task>-<run> dir (notes, reports)
        tool, task, run = name.split("-", 2)
        if not os.path.exists(f"{work}/wall_seconds"):
            continue  # in progress
        try:
            m = {"kiso": kiso, "pi": pi, "claude": claude}[tool](work)
        except Exception as ex:
            m = dict(error=str(ex)[:80])
        m.update(tool=tool, task=task, run=run,
                 wall=int(open(f"{work}/wall_seconds").read().strip()),
                 verify=open(f"{work}/verify").read().strip())
        rows.append(m)
    print(json.dumps(rows, indent=1))
    return rows

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
