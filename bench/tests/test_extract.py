#!/usr/bin/env python3
"""Regression test for the bench extraction accounting (0.1.23 fresh-mystery
round; E2 1.3.0 — the canonical switch, T7). The README tables'
fresh/total/cost-wtd columns must mean the same thing per tool, or the
comparison silently double-counts:
  - kiso (1.3.0+): the TRACE SIDECAR — the canonical block's input is
    FRESH-ONLY on both routes (the pinned sentence); a v1 sidecar's
    freshInput IS the guard's route-derived fresh; an untraced session
    falls back to the session-log raw (fresh = inputTokens − cache_read,
    the legacy openai-compat derivation).
  - pi and claude report fresh-only input: fresh = input, total = input +
    cache_read.
  - cost_weighted = fresh + 0.1 × cache_read (DeepSeek cache-hit price
    ratio).
All rows carry the uniform canonical shape: input = fresh, total = fresh +
cache_read (the v8-and-older kiso tables kept the openai-compat raw shape
— identical numbers on healthy data; the switch fixes the >100% disease
where the old fresh went NEGATIVE). Pinned on synthetic records so a
future edit cannot regress the labeling (the exact bug that produced the
"fresh ≈ system prompt size" phantom anomaly in the 0.1.22 bench).

Run: python3 tests/test_extract.py   (from bench/)
All five files, as the check chain runs them:
     node scripts/check-bench-tests.mjs   (from the repo root)
"""
import importlib.util, json, os, sys, tempfile, unittest

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BENCH)
import extract

def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(BENCH, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

extract_t5 = _load("extract-t5.py", "extract_t5")
extract_t6 = _load("extract-t6.py", "extract_t6")

def _sidecar_ledger(d, sid, requests):
    """Write a trace sidecar (header + requests + run_end) under the
    run's kiso-home; the session log of the SAME sid stays absent —
    the dedup must not double-count it when it exists either."""
    os.makedirs(f"{d}/kiso-home/sessions/traces")
    with open(f"{d}/kiso-home/sessions/traces/{sid}.jsonl", "w") as f:
        f.write(json.dumps({"schemaVersion": 2, "kind": "header", "sessionId": sid,
                            "kisoVersion": "1.3.0", "createdAt": 1}) + "\n")
        for r in requests:
            f.write(json.dumps(r) + "\n")
        f.write(json.dumps({"schemaVersion": 2, "kind": "run_end", "runId": "r1",
                            "ts": 2, "lastRequestIndex": len(requests) - 1}) + "\n")

class KisoAccountingTest(unittest.TestCase):
    def _session_dir(self, usage_events):
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            for u in usage_events:
                f.write(json.dumps({"event": {"type": "usage", **u}}) + "\n")
        return d

    def test_kiso_legacy_session_log_fresh_is_input_minus_cache(self):
        # NO sidecar: the session-log fallback — the legacy openai-compat
        # derivation, now reduced to the uniform row shape (input = fresh).
        d = self._session_dir([
            {"inputTokens": 1000, "cacheRead": 0, "outputTokens": 50},
            {"inputTokens": 2500, "cacheRead": 2200, "outputTokens": 80},
        ])
        m = extract.kiso(d)
        self.assertEqual(m["input"], 1300)          # the uniform shape: input = fresh
        self.assertEqual(m["cache_read"], 2200)
        self.assertEqual(m["fresh"], 1300)          # 1000 + (2500 − 2200)
        self.assertEqual(m["total"], 3500)          # 1300 + 2200
        self.assertEqual(m["requests"], 2)
        self.assertEqual(m["cost_weighted"], m["fresh"] + 0.1 * m["cache_read"])
        self.assertEqual(m["first_prompt"], 1000)   # first request true total: 1000 + 0
        # NOT 2000 — the v8-and-older first_prompt counted inputTokens +
        # cacheRead with the cache hit twice (raw already includes it).

    # ── unknown usage is NOT zero ────────────────────────────────────
    #
    # The runtime states the invariant and keeps it: `known: false` means the
    # provider reported NO usage, "the token fields are null, never faked as
    # zero" (packages/core/src/protocol/events.ts, Area 6). The extractor then
    # read them as `or 0` and added that to a cost total — destroying exactly
    # the distinction the product goes to the trouble of preserving, and never
    # once consulting the `known` flag the runtime sets for this purpose.
    #
    # The bias has a direction: a request whose usage is unknown still counted
    # as a request but contributed zero cost, so an arm whose provider does
    # not report usage measures as the CHEAPEST arm. In a comparison that is
    # the worst possible failure — it rewards the least observable product.

    def test_unknown_usage_is_counted_as_unknown_not_as_zero(self):
        d = self._session_dir([
            {"inputTokens": 1000, "cacheRead": 0, "outputTokens": 50, "known": True},
            {"inputTokens": None, "cacheRead": None, "outputTokens": None, "known": False},
        ])
        m = extract.kiso(d)
        # the known request is accounted exactly as before
        self.assertEqual(m["fresh"], 1000)
        self.assertEqual(m["output"], 50)
        # the unknown one is VISIBLE, and is not spent as zero
        self.assertEqual(m["unknown_requests"], 1)
        self.assertEqual(m["requests"], 2)

    def test_a_leg_with_unknown_usage_says_so(self):
        d = self._session_dir([{"inputTokens": None, "cacheRead": None, "outputTokens": None, "known": False}])
        m = extract.kiso(d)
        # A caller comparing arms must be able to refuse this leg rather than
        # read it as free. The flag is the refusal handle.
        self.assertTrue(m["usage_incomplete"])
        self.assertEqual(m["unknown_requests"], 1)

    def test_a_GENUINE_zero_is_not_unknown(self):
        # Zero is a real measurement and must stay distinguishable from
        # "nobody told us" — otherwise the fix trades one conflation for
        # another.
        d = self._session_dir([{"inputTokens": 0, "cacheRead": 0, "outputTokens": 0, "known": True}])
        m = extract.kiso(d)
        self.assertEqual(m["unknown_requests"], 0)
        self.assertFalse(m["usage_incomplete"])
        self.assertEqual(m["requests"], 1)

    def test_a_missing_field_without_a_known_flag_is_also_unknown(self):
        # Older logs predate the flag. A field that is absent is still not a
        # measured zero.
        d = self._session_dir([{"inputTokens": 900, "outputTokens": 40}])   # no cacheRead
        m = extract.kiso(d)
        self.assertEqual(m["unknown_requests"], 1)
        self.assertTrue(m["usage_incomplete"])

    def test_kiso_v2_sidecar_reads_the_canonical_block(self):
        # The df2 fixture: canonical fresh 58 + cache 1920 (raw total 1978).
        # The session log for the same sid exists — the dedup must NOT
        # also read it (no double counting).
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            f.write(json.dumps({"event": {"type": "usage", "inputTokens": 1978,
                                          "cacheRead": 1920, "outputTokens": 111}}) + "\n")
        _sidecar_ledger(d, "s", [{
            "schemaVersion": 2, "kind": "request", "requestId": "r1", "runId": "r1",
            "requestIndex": 0, "retryAttempt": 0, "provider": "openai-compat",
            "model": "deepseek-chat", "adapterVersion": "1.3.0",
            "systemPromptHash": "a" * 64, "toolSchemaHash": "b" * 64,
            "contextHash": "c" * 64, "contextManifest": [], "segmentHashes": [],
            "stablePrefixFingerprint": "d" * 64, "freshInput": 58, "cacheRead": 1920,
            "cacheWrite": None, "output": 111,
            "canonical": {"input": 58, "cacheRead": 1920, "cacheWrite": None,
                          "output": 111, "reasoning": None, "costUsd": 0.00025,
                          "pricingTableVersion": 1},
            "latencyMs": 1, "ttftMs": 1, "toolCalls": [], "outcome": "ok", "ts": 1}])
        m = extract.kiso(d)
        self.assertEqual(m["fresh"], 58)            # canonical fresh, route-agnostic
        self.assertEqual(m["cache_read"], 1920)
        self.assertEqual(m["total"], 1978)          # 58 + 1920
        self.assertEqual(m["requests"], 1)          # exactly one — the dedup held
        self.assertEqual(m["cost_weighted"], 58 + 0.1 * 1920)
        self.assertEqual(m["first_prompt"], 1978)   # first request true total

    def test_kiso_v1_sidecar_falls_back_to_the_guard_fresh(self):
        # A pre-1.3.0 sidecar: no canonical block — freshInput IS the
        # guard's route-derived fresh. The disease fixture (fresh 41 +
        # cache 12410): the OLD session-log derivation would have read
        # fresh = 41 − 12410 = −12369 (negative cost) — the fallback is
        # the fix, read as defaults, never a crash (R1d-1).
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        _sidecar_ledger(d, "s", [{
            "schemaVersion": 1, "kind": "request", "requestId": "r1", "runId": "r1",
            "requestIndex": 0, "retryAttempt": 0, "provider": "anthropic",
            "model": "deepseek-chat", "adapterVersion": "1.2.0",
            "systemPromptHash": "a" * 64, "toolSchemaHash": "b" * 64,
            "contextHash": "c" * 64, "contextManifest": [], "segmentHashes": [],
            "stablePrefixFingerprint": "d" * 64, "freshInput": 41, "cacheRead": 12410,
            "cacheWrite": None, "output": 320,
            "latencyMs": 1, "ttftMs": 1, "toolCalls": [], "outcome": "ok", "ts": 1}])
        m = extract.kiso(d)
        self.assertEqual(m["fresh"], 41)            # the guard's fresh, never negative
        self.assertEqual(m["cache_read"], 12410)
        self.assertEqual(m["total"], 12451)
        self.assertEqual(m["cost_weighted"], 41 + 0.1 * 12410)

    def test_kiso_mixed_run_traced_plus_untraced_sessions(self):
        # One traced session (sidecar canonical) + one untraced session
        # (session-log legacy) in the SAME run: each line is reduced once,
        # at its own convention, into the one uniform row.
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/legacy.jsonl", "w") as f:
            f.write(json.dumps({"event": {"type": "usage", "inputTokens": 5000,
                                          "cacheRead": 4600, "outputTokens": 60}}) + "\n")
        _sidecar_ledger(d, "traced", [{
            "schemaVersion": 2, "kind": "request", "requestId": "r1", "runId": "r1",
            "requestIndex": 0, "retryAttempt": 0, "provider": "openai-compat",
            "model": "deepseek-chat", "adapterVersion": "1.3.0",
            "systemPromptHash": "a" * 64, "toolSchemaHash": "b" * 64,
            "contextHash": "c" * 64, "contextManifest": [], "segmentHashes": [],
            "stablePrefixFingerprint": "d" * 64, "freshInput": 100, "cacheRead": 900,
            "cacheWrite": None, "output": 30,
            "canonical": {"input": 100, "cacheRead": 900, "cacheWrite": None,
                          "output": 30, "reasoning": None, "costUsd": 0.0001,
                          "pricingTableVersion": 1},
            "latencyMs": 1, "ttftMs": 1, "toolCalls": [], "outcome": "ok", "ts": 1}])
        m = extract.kiso(d)
        self.assertEqual(m["fresh"], 500)           # 400 (legacy) + 100 (canonical)
        self.assertEqual(m["cache_read"], 5500)     # 4600 + 900
        self.assertEqual(m["total"], 6000)
        self.assertEqual(m["requests"], 2)
        self.assertEqual(m["cost_weighted"], 500 + 0.1 * 5500)

    # The comparators matter MORE than kiso here: we do not control pi's or
    # Claude Code's trace format, so a field they stop emitting would make
    # that arm measure as free — in the very comparison a claim rests on.

    def test_pi_a_missing_usage_field_is_unknown_not_zero(self):
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout.log", "w") as f:
            f.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {"input": 900, "cacheRead": 0, "output": 40}}}) + "\n")
            f.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {"input": 500}}}) + "\n")  # no output, no cacheRead
        m = extract.pi(d)
        self.assertEqual(m["unknown_requests"], 1)
        self.assertTrue(m["usage_incomplete"])
        self.assertEqual(m["requests"], 2)
        self.assertEqual(m["input"], 900)   # the incomplete record is not spent as zero

    def test_claude_a_missing_usage_field_is_unknown_not_zero(self):
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout.log", "w") as f:
            f.write(json.dumps({"usage": {"input_tokens": 900, "cache_read_input_tokens": 10}, "num_turns": 3}) + "\n")  # no output_tokens
        m = extract.claude(d)
        self.assertTrue(m["usage_incomplete"])
        self.assertEqual(m["unknown_requests"], 1)

    def test_claude_a_complete_usage_block_is_not_flagged(self):
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout.log", "w") as f:
            f.write(json.dumps({"usage": {"input_tokens": 900, "cache_read_input_tokens": 10, "output_tokens": 40}, "num_turns": 3}) + "\n")
        m = extract.claude(d)
        self.assertFalse(m["usage_incomplete"])
        self.assertEqual(m["unknown_requests"], 0)
        self.assertEqual(m["cost_equivalent"], 900 + 0.02 * 10 + 4 * 40)

    def test_pi_and_claude_fresh_is_input(self):
        # pi: message_end JSONL with usage.input (fresh-only).
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout.log", "w") as f:
            f.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {"input": 800, "cacheRead": 1500, "output": 90}}}) + "\n")
        m = extract.pi(d)
        self.assertEqual(m["fresh"], 800)           # pi input is fresh-only
        self.assertEqual(m["total"], 2300)
        self.assertEqual(m["cost_weighted"], 800 + 0.1 * 1500)

        # claude: single JSON with input_tokens (fresh-only) + cache_read.
        d2 = tempfile.mkdtemp()
        with open(f"{d2}/stdout.log", "w") as f:
            json.dump({"usage": {"input_tokens": 900, "cache_read_input_tokens": 5000, "output_tokens": 70}}, f)
        m2 = extract.claude(d2)
        self.assertEqual(m2["fresh"], 900)
        self.assertEqual(m2["total"], 5900)
        self.assertEqual(m2["cost_weighted"], 900 + 0.1 * 5000)

    def test_t6_buckets_split_at_inputs_in_log_order(self):
        # The durable log orders input-then-usage; the FIRST input must not
        # produce an empty leading bucket and the LAST turn's usage must not
        # vanish (the bug the input-first ordering would have caused).
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        for p in range(4):
            with open(f"{d}/wall_{p + 1}", "w") as f:
                f.write(str(10 + p))
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            for i in range(24):
                f.write(json.dumps({"event": {"type": "user_input"}}) + "\n")
                f.write(json.dumps({"event": {"type": "usage",
                    "inputTokens": 1000 + i, "cacheRead": 0,
                    "outputTokens": 50}}) + "\n")
        b = extract_t6.kiso(d)
        self.assertEqual(len(b), 4)
        for p, bucket in enumerate(b):
            self.assertEqual(bucket["requests"], 6)
            self.assertEqual(bucket["cache_read"], 0)
            self.assertEqual(bucket["total"], 6000 + 36 * p + 15)  # i = 6p..6p+5
            self.assertEqual(bucket["fresh"], bucket["total"])
            self.assertEqual(bucket["wall"], 10 + p)

    def test_t6_bucket_boundary_carries_the_resume_cost(self):
        # The first turn of each kiso process re-reads the whole session:
        # turn 7 (bucket 2's first turn) is cache-heavy. The bucketing must
        # land that cost in bucket 2, not spread it.
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        for p in range(4):
            with open(f"{d}/wall_{p + 1}", "w") as f:
                f.write("1")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            for i in range(24):
                f.write(json.dumps({"event": {"type": "user_input"}}) + "\n")
                c = 4600 if i == 6 else 0          # the resume turn
                n = 5000 if i == 6 else 1000
                f.write(json.dumps({"event": {"type": "usage",
                    "inputTokens": n, "cacheRead": c,
                    "outputTokens": 80}}) + "\n")
        b = extract_t6.kiso(d)
        b1, b2 = b[0], b[1]
        self.assertEqual(b1["fresh"], 6000)        # 6 × 1000, no cache
        self.assertEqual(b2["fresh"], 5400)        # 400 + 5 × 1000
        self.assertEqual(b2["cache_read"], 4600)   # the resume prefix
        self.assertEqual(b2["total"], 10000)       # 5000 + 5 × 1000
        self.assertEqual(b2["cost_weighted"], 5400 + 460)
        self.assertEqual(b[2]["fresh"], 6000)      # buckets 3-4 untouched

    def test_t6_pi_buckets_sum_invocations_and_skip_missing_logs(self):
        # 24 -p invocations, one stdout-N.log each; per-bucket wall is the
        # runner's sum (here: synthetic files). Absent logs (a crashed turn)
        # are skipped, and the accounting stays fresh-only input.
        d = tempfile.mkdtemp()
        for i in range(1, 21):                     # turns 21-24 never ran
            with open(f"{d}/stdout-{i}.log", "w") as f:
                f.write(json.dumps({"type": "message_end", "message": {
                    "role": "assistant",
                    "usage": {"input": 800, "cacheRead": 1500, "output": 90}}}) + "\n")
        for p in range(4):
            with open(f"{d}/wall_{p + 1}", "w") as f:
                f.write(str(3))
        b = extract_t6.pi(d)
        self.assertEqual(len(b), 4)
        for bucket in b[:3]:
            self.assertEqual(bucket["requests"], 6)
            self.assertEqual(bucket["fresh"], 4800)
            self.assertEqual(bucket["total"], 13800)
            self.assertEqual(bucket["cost_weighted"], 4800 + 900)  # 0.1 × 9000 cache
        self.assertEqual(b[3]["requests"], 2)      # only turns 19-20 ran
        self.assertEqual(b[3]["fresh"], 1600)
        self.assertEqual(b[3]["wall"], 3)

    def test_t5_kiso_uses_same_accounting(self):
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            f.write(json.dumps({"event": {"type": "usage", "inputTokens": 5000, "cacheRead": 4600, "outputTokens": 60}}) + "\n")
        m = extract_t5.kiso(d)
        self.assertEqual(m["fresh"], 400)
        self.assertEqual(m["total"], 5000)
        self.assertEqual(m["cost_weighted"], 400 + 0.1 * 4600)

    # ── the T5 extractor is a SEPARATE entry point ────────────────────
    #
    # A T5-based calibration does not go through extract.py at all. Fixing
    # only the file I happened to find would have left the path the
    # calibration actually uses producing the biased figures the fix exists
    # to prevent (Astra, 2026-09-13). And it emitted only the v1 metric,
    # so it could not produce the measure the claim names as PRIMARY.

    def test_t5_unknown_usage_is_not_zero(self):
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            f.write(json.dumps({"event": {"type": "usage", "inputTokens": 5000, "cacheRead": 4600, "outputTokens": 60, "known": True}}) + "\n")
            f.write(json.dumps({"event": {"type": "usage", "inputTokens": None, "cacheRead": None, "outputTokens": None, "known": False}}) + "\n")
        m = extract_t5.kiso(d)
        self.assertEqual(m["fresh"], 400)
        self.assertEqual(m["unknown_requests"], 1)
        self.assertTrue(m["usage_incomplete"])

    def test_t5_emits_the_primary_measure(self):
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            f.write(json.dumps({"event": {"type": "usage", "inputTokens": 5000, "cacheRead": 4600, "outputTokens": 60, "known": True}}) + "\n")
        m = extract_t5.kiso(d)
        # the claim's PRIMARY measure, on the entry point a T5 calibration uses
        self.assertEqual(m["cost_equivalent"], 400 + 0.02 * 4600 + 4 * 60)

    def test_t5_pi_and_claude_carry_the_same_two_handles(self):
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout-1.log", "w") as f:
            f.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {"input": 500}}}) + "\n")  # incomplete
        m = extract_t5.pi(d)
        self.assertTrue(m["usage_incomplete"])
        self.assertIn("cost_equivalent", m)
        d2 = tempfile.mkdtemp()
        with open(f"{d2}/stdout-1.log", "w") as f:
            f.write(json.dumps({"usage": {"input_tokens": 900, "cache_read_input_tokens": 10}, "num_turns": 2}) + "\n")  # no output
        m2 = extract_t5.claude(d2)
        self.assertTrue(m2["usage_incomplete"])
        self.assertIn("cost_equivalent", m2)


class MetricV2Test(unittest.TestCase):
    """metric v2 — `cost_equivalent` = F + 0.02*H + 4*O.

    Pinned for all three tools, and pinned NOT to disturb v1. The reason v2
    exists is the last test in this class: v1 counts only what goes IN, so a
    change that makes the agent write more to say the same thing is free
    under v1 and is not free on the bill.
    """

    def _kiso(self, fresh, cache, out):
        d = tempfile.mkdtemp()
        os.makedirs(f"{d}/kiso-home/sessions")
        with open(f"{d}/kiso-home/sessions/s.jsonl", "w") as f:
            f.write(json.dumps({"event": {"type": "usage",
                                          "inputTokens": fresh + cache,
                                          "cacheRead": cache,
                                          "outputTokens": out}}) + "\n")
        return extract.kiso(d)

    def _pi(self, inp, cache, out):
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout.log", "w") as f:
            f.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {
                "input": inp, "cacheRead": cache, "output": out}}}) + "\n")
        return extract.pi(d)

    def _claude(self, inp, cache, out):
        d = tempfile.mkdtemp()
        with open(f"{d}/stdout.log", "w") as f:
            f.write("[claude-code:warn] {\"noise\": true}\n")
            f.write(json.dumps({"num_turns": 3, "usage": {
                "input_tokens": inp, "cache_read_input_tokens": cache,
                "output_tokens": out}}) + "\n")
        return extract.claude(d)

    def test_kiso_cost_equivalent(self):
        m = self._kiso(1000, 20000, 500)
        self.assertEqual(m["cost_equivalent"], 1000 + 0.02 * 20000 + 4 * 500)

    def test_pi_cost_equivalent(self):
        m = self._pi(1000, 20000, 500)
        self.assertEqual(m["cost_equivalent"], 1000 + 0.02 * 20000 + 4 * 500)

    def test_claude_cost_equivalent(self):
        m = self._claude(1000, 20000, 500)
        self.assertEqual(m["cost_equivalent"], 1000 + 0.02 * 20000 + 4 * 500)
        self.assertEqual(m["output"], 500)   # the claude row still reports output

    def test_v1_is_untouched_by_v2_for_every_tool(self):
        # A metric that changes under a comparison is not a metric. Every row
        # already published was judged on v1; v2 rides beside it.
        for m in (self._kiso(1000, 20000, 500),
                  self._pi(1000, 20000, 500),
                  self._claude(1000, 20000, 500)):
            self.assertEqual(m["cost_weighted"], 1000 + 0.1 * 20000)
            self.assertNotEqual(m["cost_weighted"], m["cost_equivalent"])

    def test_output_only_growth_is_free_under_v1_and_priced_under_v2(self):
        # THE reason v2 exists, stated as a test rather than as a comment.
        same_in = self._kiso(1000, 20000, 500)
        writes_more = self._kiso(1000, 20000, 1500)
        self.assertEqual(same_in["cost_weighted"], writes_more["cost_weighted"])
        self.assertEqual(writes_more["cost_equivalent"] - same_in["cost_equivalent"],
                         4 * 1000)

    def test_v2_weights_cache_lower_than_v1(self):
        # Why the two metrics can disagree on the same data, and in which
        # direction: on a cache-heavy row v1 reads HIGHER. Measured on the
        # PR-1b pairs as +42.4% (v1) against +32.5% (v2).
        m = self._kiso(1000, 100000, 100)
        self.assertGreater(m["cost_weighted"], m["cost_equivalent"])


class UnknownSurvivesTheSidecar(unittest.TestCase):
    """Astra F33-1 / F33-2: the counterexamples, pinned.

    Both were found by adding evidence, not by removing it — a leg read as
    incomplete became complete when a conforming sidecar was added beside
    its log, and a request whose usage went missing left the request count
    entirely. Both hide in the same direction: the arm that reports least
    measures cheapest.
    """

    KNOWN = {"event": {"type": "usage", "inputTokens": 1000, "cacheRead": 0, "outputTokens": 50, "known": True}}
    UNKNOWN = {"event": {"type": "usage", "inputTokens": None, "cacheRead": None, "outputTokens": None, "known": False}}

    def _leg(self, sidecar_records=None):
        work = tempfile.mkdtemp(prefix="f33-")
        sessions = os.path.join(work, "kiso-home", "sessions")
        os.makedirs(sessions)
        with open(os.path.join(sessions, "sid.jsonl"), "w") as fh:
            for r in (self.KNOWN, self.UNKNOWN):
                fh.write(json.dumps(r) + "\n")
        if sidecar_records is not None:
            os.makedirs(os.path.join(sessions, "traces"))
            with open(os.path.join(sessions, "traces", "sid.jsonl"), "w") as fh:
                for r in sidecar_records:
                    fh.write(json.dumps(r) + "\n")
        return work

    def test_a_pre_v5_sidecar_does_not_erase_the_unknown(self):
        # The sidecar is read FIRST and excludes the plain log, and before
        # v5 its four zeros cannot say whether anyone measured. The plain
        # log still can, and it is consulted rather than shadowed.
        bare = extract.kiso(self._leg())
        withcar = extract.kiso(self._leg([
            {"kind": "request", "canonical": {"input": 1000, "cacheRead": 0, "output": 50}},
            {"kind": "request", "canonical": {"input": 0, "cacheRead": 0, "output": 0}},
        ]))
        self.assertEqual(bare["unknown_requests"], 1)
        self.assertEqual(withcar["unknown_requests"], 1, "adding a sidecar erased the unknown")
        self.assertTrue(withcar["usage_incomplete"])

    def test_a_v5_sidecar_says_so_itself(self):
        m = extract.kiso(self._leg([
            {"kind": "request", "usageKnown": True, "canonical": {"input": 1000, "cacheRead": 0, "output": 50}},
            {"kind": "request", "usageKnown": False, "canonical": {"input": 0, "cacheRead": 0, "output": 0}},
        ]))
        self.assertEqual(m["unknown_requests"], 1)

    def test_a_genuine_zero_stays_known(self):
        # The fix must not turn every zero into an unknown: a provider that
        # really reported zero said something, and erasing that would be the
        # same failure pointed the other way.
        m = extract.kiso(self._leg([
            {"kind": "request", "usageKnown": True, "canonical": {"input": 0, "cacheRead": 0, "output": 0}},
        ]))
        self.assertEqual(m["unknown_requests"], 0)
        self.assertFalse(m["usage_incomplete"])

    def test_pi_keeps_a_request_whose_usage_went_missing(self):
        work = tempfile.mkdtemp(prefix="f33-pi-")
        with open(os.path.join(work, "stdout.log"), "w") as fh:
            fh.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {"input": 1000, "cacheRead": 0, "output": 50}}}) + "\n")
            fh.write(json.dumps({"type": "message_end", "message": {"role": "assistant", "usage": {"cacheRead": 0, "output": 50}}}) + "\n")
        m = extract.pi(work)
        self.assertEqual(m["requests"], 2, "a request with no input vanished from the count")
        self.assertEqual(m["unknown_requests"], 1)
        self.assertTrue(m["usage_incomplete"])

class PiRolesAreNotAllRequests(unittest.TestCase):
    """F33-R2 (Astra): pi emits `message_end` for user messages and tool
    results too. The real calibration archive holds 8 user, 32 assistant and
    24 toolResult; counting all of them turned a fully measured 32-request
    leg into 64 requests with 32 unknown, and rejected a valid comparator."""

    def _leg(self, events):
        work = tempfile.mkdtemp(prefix="f33r2-")
        with open(os.path.join(work, "stdout.log"), "w") as fh:
            for e in events:
                fh.write(json.dumps(e) + "\n")
        return work

    @staticmethod
    def _msg(role, **usage):
        m = {"role": role}
        if usage:
            m["usage"] = usage
        return {"type": "message_end", "message": m}

    def test_only_assistant_completions_are_requests(self):
        m = extract.pi(self._leg([
            self._msg("user"),
            self._msg("assistant", input=100, cacheRead=10, output=5),
            self._msg("toolResult"),
            self._msg("assistant", input=200, cacheRead=20, output=7),
        ]))
        self.assertEqual(m["requests"], 2, "a user message or a tool result is not a model request")
        self.assertEqual(m["unknown_requests"], 0)
        self.assertEqual(m["fresh"], 300)

    def test_an_assistant_completion_with_no_usage_is_still_a_request(self):
        # F33-2's rule survives R2: it now applies to completions.
        m = extract.pi(self._leg([self._msg("assistant"), self._msg("user")]))
        self.assertEqual(m["requests"], 1)
        self.assertEqual(m["unknown_requests"], 1)
        self.assertTrue(m["usage_incomplete"])

    def test_a_MISSING_role_is_neither_dropped_nor_priced(self):
        # Calling it assistant re-admits what R2 excludes; dropping it makes
        # a request vanish. It counts, and it counts as unknown.
        m = extract.pi(self._leg([{"type": "message_end", "message": {"usage": {"input": 9, "cacheRead": 0, "output": 1}}}]))
        self.assertEqual(m["requests"], 1)
        self.assertEqual(m["unknown_requests"], 1)
        self.assertEqual(m["fresh"], 0, "an event we cannot classify is never priced")
        self.assertTrue(m["usage_incomplete"])

def _v5_request(marker, canonical=True, **over):
    """A conforming v5 request record, with the completeness marker under
    test. `canonical` selects which of the extractor's TWO branches reads
    it — the canonical block (v2+) or the guard's freshInput (v1)."""
    rec = {"schemaVersion": 5, "kind": "request", "requestId": "r1", "runId": "r1",
           "requestIndex": 0, "retryAttempt": 0, "provider": "openai-compat",
           "model": "m", "adapterVersion": "1", "systemPromptHash": "a" * 64,
           "toolSchemaHash": "b" * 64, "contextHash": "c" * 64, "contextManifest": [],
           "segmentHashes": [], "stablePrefixFingerprint": "d" * 64,
           "freshInput": 58, "cacheRead": 1920, "cacheWrite": None, "output": 111,
           "latencyMs": 1, "ttftMs": 1, "toolCalls": [], "outcome": "ok", "ts": 1}
    if marker is not _ABSENT:
        rec["usageKnown"] = marker
    if canonical:
        rec["canonical"] = {"input": 58, "cacheRead": 1920, "cacheWrite": None,
                            "output": 111, "reasoning": None, "costUsd": 0.1,
                            "pricingTableVersion": 1}
    rec.update(over)
    return rec


_ABSENT = object()


class MalformedCompletenessMarkerTest(unittest.TestCase):
    """F33-RR3 (Astra) — the consumer half of "unknown is not zero".

    The TypeScript validator rejects a non-boolean `usageKnown`; these two
    extractors parse the sidecar themselves and never call it. They tested
    `is False`, so a record carrying the STRING "false" was not unknown —
    and, the key being present, it also skipped the pre-v5 fallback that
    consults the sibling plain log. A corrupt marker read as a fully
    measured request: the very defect the marker exists to close, through
    the one door nobody checked.

    Both entrypoints, both record branches, because the rule lived in four
    places before it lived in one.
    """

    def _leg(self, records):
        d = tempfile.mkdtemp()
        _sidecar_ledger(d, "s", records)
        return d

    def test_a_string_false_is_not_a_boolean_false(self):
        for name, fn in (("extract", extract.kiso), ("extract-t5", extract_t5.kiso)):
            for branch in (True, False):
                with self.subTest(entrypoint=name, canonical=branch):
                    m = fn(self._leg([_v5_request("false", canonical=branch)]))
                    self.assertEqual(m["unknown_requests"], 1, "a corrupt marker is not a measurement")
                    self.assertTrue(m["usage_incomplete"])
                    self.assertEqual(m["fresh"], 0, "an unmeasured request is never priced")

    def test_every_non_boolean_shape_fails_CLOSED(self):
        # 1 and 0 compare EQUAL to True/False in Python and are not the
        # same statement; None is the shape a half-written record takes.
        for marker in ("false", "true", 1, 0, None, [], {}):
            with self.subTest(marker=marker):
                m = extract.kiso(self._leg([_v5_request(marker)]))
                self.assertEqual(m["unknown_requests"], 1)
                self.assertTrue(m["usage_incomplete"])

    def test_the_booleans_still_mean_what_they_meant(self):
        for name, fn in (("extract", extract.kiso), ("extract-t5", extract_t5.kiso)):
            for branch in (True, False):
                with self.subTest(entrypoint=name, canonical=branch):
                    known = fn(self._leg([_v5_request(True, canonical=branch)]))
                    self.assertEqual(known["unknown_requests"], 0)
                    self.assertFalse(known["usage_incomplete"])
                    self.assertEqual(known["fresh"], 58)
                    unknown = fn(self._leg([_v5_request(False, canonical=branch)]))
                    self.assertEqual(unknown["unknown_requests"], 1)
                    self.assertTrue(unknown["usage_incomplete"])

    def test_an_ABSENT_marker_keeps_the_pre_v5_policy(self):
        # A record from before the marker existed must NOT be treated as
        # corrupt: absence means "this generation could not say", and the
        # sibling plain log decides. Losing that would make every archived
        # v1-v4 leg read as incomplete.
        m = extract.kiso(self._leg([_v5_request(_ABSENT)]))
        self.assertEqual(m["unknown_requests"], 0, "absence is not corruption")
        self.assertEqual(m["fresh"], 58)


if __name__ == "__main__":
    unittest.main()
