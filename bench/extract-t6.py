#!/usr/bin/env python3
"""Extract T6 metrics: the long-curve scenario — 24 progressive turns in
FOUR 6-turn buckets. The DIVERGENCE CURVE needs per-bucket cost, not just
the total: each bucket carries the tool's own usage records summed over
the bucket's turns plus the bucket's wall seconds (kiso: wall_1..wall_4,
the per-process walls — the process boundaries ARE the bucket boundaries;
pi: the runner sums its per-invocation walls into the same files).

ACCOUNTING: the uniform definitions of extract.py / extract-t5.py —
kiso's inputTokens INCLUDES the cache-hit prefix (fresh = input − cache,
total = input); pi reports fresh-only input (fresh = input, total =
input + cache); cost_weighted = fresh + 0.1 × cache_read (DeepSeek's
cache-hit price ratio). Pinned by bench/tests/test_extract.py.

kiso's per-turn split: the durable session log, cut at user_input events
(each turn = one input; the FIRST usage after a turn's input belongs to
that turn; usage before any input — none, the log always opens with the
input). pi: each stdout-N.log is one turn (one -p invocation).
"""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from usage_marker import usage_marker, unmeasured, MALFORMED

BUCKETS = 4
TURNS_PER_BUCKET = 6


def _sum_usage(events):
    """UNKNOWN IS NOT ZERO.

    This summed `u.get("cacheRead") or 0` over every usage event, so a
    request the provider never reported usage for counted as a request
    costing nothing — and the bucket carrying it read as the cheap one. The
    runtime states the convention explicitly (`known: false` means the
    fields are null and are "never faked as zero"); reading them with `or
    0` destroyed exactly the distinction the flag exists to carry.

    Unmeasured requests are COUNTED and reported separately. A bucket with
    unknowns is not a bucket with a smaller number.
    """
    d = dict(input=0, cache=0, output=0, reasoning=0, requests=0, unknown=0)
    for u in events:
        d["requests"] += 1
        i, ca, o = u.get("inputTokens"), u.get("cacheRead"), u.get("outputTokens")
        if u.get("known") is False or i is None or ca is None or o is None:
            d["unknown"] += 1
            continue
        d["cache"] += ca
        d["output"] += o
        d["input"] += i
        # The reasoning split, recorded for the first time in schema 6. It
        # is OPTIONAL: absent means the provider did not report a split,
        # which is not the same as a split of zero — so it is summed only
        # where stated and the bucket says how many requests stated it.
        r = u.get("reasoningTokens")
        if isinstance(r, int):
            d["reasoning"] += r
            d["reasoning_reported"] = d.get("reasoning_reported", 0) + 1
    return d


def kiso(work):
    # The durable log orders input-then-usage: each user_input STARTS a turn
    # and the usage events that follow it belong to that turn (verified
    # against kiso-T5-1's session log). One entry per input, in log order.
    turns = []
    turn_usage = []
    for f in glob.glob(f"{work}/kiso-home/sessions/*.jsonl"):
        for line in open(f):
            e = json.loads(line)["event"]
            if e["type"] == "user_input":
                turn_usage = []
                turns.append(turn_usage)
            elif e["type"] == "usage":
                turn_usage.append(e)
    buckets = []
    for p in range(BUCKETS):
        slice_ = turns[p * TURNS_PER_BUCKET:(p + 1) * TURNS_PER_BUCKET]
        u = _sum_usage([u for t in slice_ for u in t])
        b = dict(fresh=u["input"] - u["cache"], cache_read=u["cache"],
                 output=u["output"], requests=u["requests"],
                 unknown_requests=u["unknown"], reasoning=u["reasoning"],
                 reasoning_reported=u.get("reasoning_reported", 0))
        b["total"] = u["input"]
        b["cost_weighted"] = b["fresh"] + 0.1 * b["cache_read"]
        b["wall"] = int(open(f"{work}/wall_{p + 1}").read().strip())
        buckets.append(b)
    return buckets


def pi(work):
    buckets = []
    for p in range(BUCKETS):
        u = dict(input=0, cache=0, output=0, requests=0, unknown=0)
        for i in range(p * TURNS_PER_BUCKET + 1, (p + 1) * TURNS_PER_BUCKET + 1):
            path = f"{work}/stdout-{i}.log"
            if not os.path.exists(path):
                continue
            for line in open(path):
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(ev, dict) or ev.get("type") != "message_end":
                    continue
                m = ev.get("message") or {}
                # A REQUEST IS AN ASSISTANT MESSAGE. Exactly half of this
                # arm's message_end events are role=user and role=toolResult
                # — the turn's input and its tool results — and they carry
                # no usage because they are not model responses.
                #
                # The old filter was `if "input" in u2`, which happened to
                # exclude them for the wrong reason, and would have silently
                # dropped a genuine ASSISTANT response whose usage lacked a
                # field. Replacing it with "no input means unmeasured" was
                # worse: it reported this arm as 170 requests, 85 of them
                # unmeasured — a claim that the other product is half
                # unobservable, which its log flatly contradicts. Filter on
                # what a request IS, then apply unknown-is-not-zero inside.
                if m.get("role") != "assistant":
                    continue
                u2 = m.get("usage")
                u["requests"] += 1
                if not isinstance(u2, dict):
                    u["unknown"] += 1
                    continue
                iv, cv, ov = u2.get("input"), u2.get("cacheRead"), u2.get("output")
                if iv is None or ov is None:
                    u["unknown"] += 1
                    continue
                u["input"] += iv
                u["cache"] += cv or 0
                u["output"] += ov
                # THIS ARM REPORTS ITS REASONING TOO, under the field name
                # `reasoning`. Reading only our own spelling made it look
                # like the other product reported none at all, which is the
                # shape of a false comparative claim: "we measure our
                # thinking and they do not". They do — on every assistant
                # message. Summed only where STATED; absent is not zero.
                rv = u2.get("reasoning")
                if isinstance(rv, int):
                    u["reasoning"] = u.get("reasoning", 0) + rv
                    u["reasoning_reported"] = u.get("reasoning_reported", 0) + 1
        b = dict(fresh=u["input"], cache_read=u["cache"], output=u["output"],
                 requests=u["requests"], unknown_requests=u["unknown"],
                 reasoning=u.get("reasoning", 0),
                 reasoning_reported=u.get("reasoning_reported", 0))
        b["total"] = u["input"] + u["cache"]
        b["cost_weighted"] = u["input"] + 0.1 * u["cache"]
        b["wall"] = int(open(f"{work}/wall_{p + 1}").read().strip())
        buckets.append(b)
    return buckets


def claude(work):
    """Claude Code, per bucket.

    Like pi, one stdout-N.log per turn — so the same bucketing applies. The
    usage convention is Anthropic's: input_tokens is FRESH-ONLY, cache
    reads are reported separately (extract.py pins the same reading).

    UNKNOWN IS NOT ZERO here too: a turn whose result carries no usage
    block, or a usage block missing a field, is COUNTED as unmeasured and
    contributes nothing — never read as a free turn.
    """
    buckets = []
    for p in range(BUCKETS):
        u = dict(input=0, cache=0, output=0, requests=0, unknown=0)
        for i in range(p * TURNS_PER_BUCKET + 1, (p + 1) * TURNS_PER_BUCKET + 1):
            path = f"{work}/stdout-{i}.log"
            if not os.path.exists(path):
                continue
            d = None
            for line in open(path):
                line = line.strip()
                if not line.startswith("{"):
                    continue          # CC prints warnings around the result JSON
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(o, dict) and "usage" in o:
                    d = o             # keep the LAST object carrying usage
            if d is None:
                u["requests"] += 1
                u["unknown"] += 1
                continue
            uu = d.get("usage") or {}
            iv = uu.get("input_tokens")
            cv = uu.get("cache_read_input_tokens")
            ov = uu.get("output_tokens")
            u["requests"] += 1
            if iv is None or cv is None or ov is None:
                u["unknown"] += 1
                continue
            u["input"] += iv
            u["cache"] += cv
            u["output"] += ov
        b = dict(fresh=u["input"], cache_read=u["cache"], output=u["output"],
                 requests=u["requests"], unknown_requests=u["unknown"],
                 reasoning=0, reasoning_reported=0)
        b["total"] = u["input"] + u["cache"]
        b["cost_weighted"] = u["input"] + 0.1 * u["cache"]
        try:
            b["wall"] = int(open(f"{work}/wall_{p + 1}").read().strip())
        except OSError:
            b["wall"] = None
        buckets.append(b)
    return buckets


def main(workdir):
    rows = []
    # E4-e scopes a round under runs/<round>/, and this glob only ever
    # looked one level down — so every leg of every scoped round was
    # invisible to the extractor and it printed an empty list, which reads
    # exactly like "the round produced nothing".
    legs = sorted(set(glob.glob(workdir + "/runs/*T6*")
                      + glob.glob(workdir + "/runs/*/*T6*")))
    for work in legs:
        name = os.path.basename(work)
        tool, task, run = name.split("-", 2)
        if not os.path.exists(f"{work}/wall_1"):
            continue
        try:
            buckets = {"kiso": kiso, "pi": pi, "claude": claude}[tool](work)
            m = dict(tool=tool, task=task, run=run, buckets=buckets,
                     verify=open(f"{work}/verify").read().strip())
            m["round"] = os.path.basename(os.path.dirname(work))
            if m["round"] == "runs":
                m["round"] = None
            # The sidecars, surfaced rather than left on disk: the verdict
            # needs the per-check detail, and the arm a leg ACTUALLY ran as.
            for key, fname in (("effort_bound", "effort_bound"),
                               ("edit_echo", "edit_echo"),
                               ("edit_echo_requested", "edit_echo_requested"),
                               ("status", "status")):
                try:
                    m[key] = open(f"{work}/{fname}").read().strip()
                except OSError:
                    m[key] = None
            try:
                with open(f"{work}/verify.json") as fh:
                    v = json.load(fh)
                m["verify_predicate"] = v.get("predicate")
                m["boundary"] = v.get("boundary")
                m["scope"] = v.get("scope")
            except (OSError, ValueError):
                m["verify_predicate"] = None
        except Exception as ex:
            m = dict(tool=tool, task=task, run=run, error=str(ex)[:80])
        rows.append(m)
    print(json.dumps(rows, indent=1))
    return rows


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
