/**
 * E2 (1.3.0) — the CLI's canonical usage consumer (R2a-1 ruling,
 * 2026-08-13): the mixed-convention consumer at chat.ts was a heal, and
 * this file pins the OLD→NEW difference — an EXISTING-BEHAVIOR CHANGE,
 * declared, never a silent side-fix.
 *
 * OLD (pre-heal, per-route raw):
 *  - openai-compat: `in` was the provider-raw TOTAL (fresh + cache) — the
 *    >100% cache-ratio disease: raw {input 111, cacheRead 1024} rendered
 *    "in 111" and the recap's cache % (then cache/in) was 923%.
 *  - anthropic: `in` was fresh as-is — already canonical; the miss
 *    estimate ran min-of-fresh-deltas − cacheRead → always below the
 *    floor → the miss signal never fired (silent).
 *  - the miss estimate: min(prevIn, in) − cacheRead, prevIn = the raw in.
 *
 * NEW (post-heal, canonical at the route):
 *  - `in` is FRESH-ONLY on BOTH routes (the pinned sentence) — the same
 *    canonical meaning the trace block carries; the recap's cache % is
 *    cache/(in+cache), never > 100% (T5, render.ts).
 *  - the miss estimate runs on the TOTAL side (fresh + cache): on
 *    openai-compat the numbers are IDENTICAL (its old `in` was total); on
 *    anthropic it is the fix (min-of-totals, the semantics the
 *    openai-compat side always had).
 *  - an unknown-usage event cannot kill the signal: the carrier recovers
 *    on the next known event (the old consumer's carrier stayed null
 *    forever).
 */

import { describe, expect, it } from "vitest";
import type { Usage } from "@vincemakes/kiso-core";
import { accumulateUsage, usageFromEvent } from "../src/chat.js";

/** The canonical df2 fixture (E1's reconciliation probe): raw total 1978,
 *  cache 1920 → canonical fresh 58. */
function df2(): Usage {
	return { seq: 1, type: "usage", inputTokens: 1978, outputTokens: 111, cacheRead: 1920, cacheWrite: null, known: true };
}

function event(partial: Partial<Usage>): Usage {
	return { seq: 1, type: "usage", inputTokens: 1978, outputTokens: 111, cacheRead: 1920, cacheWrite: null, known: true, ...partial };
}

describe("E2 R2a-1 — the CLI usage consumer is canonical (in is FRESH-ONLY)", () => {
	it("openai-compat: in is the canonical fresh count, never the raw total (OLD: in = 111 → NEW: in = 0)", () => {
		const d = usageFromEvent("openai-compat", event({ inputTokens: 111, cacheRead: 1024, outputTokens: 50 }), null);
		// OLD pinned: { in: 111, out: 50, cache: 1024 } — the raw total in the
		// status line (the 923% disease); NEW: the canonical fresh count.
		expect(d.usage).toEqual({ in: 0, out: 50, cache: 1024, known: true });
	});

	it("openai-compat: the df2 fixture canonicalizes (1978 − 1920 = 58 fresh) and total = the raw total", () => {
		const d = usageFromEvent("openai-compat", df2(), null);
		expect(d.usage.in).toBe(58);
		expect(d.usage.out).toBe(111);
		expect(d.usage.cache).toBe(1920);
		expect(d.total).toBe(1978); // the miss estimate's carrier — the raw total, preserved
	});

	it("openai-compat: the miss estimate is numerically IDENTICAL to the pre-heal formula", () => {
		// OLD: min(prev, 50000) − 45000 = 5000 (fired, above the 1024 floor).
		// NEW: total = max(0, 50000−45000) + 45000 = 50000 → identical 5000.
		const d = usageFromEvent("openai-compat", event({ inputTokens: 50000, cacheRead: 45000, outputTokens: 100 }), 50000);
		expect(d.missed).toBe(5000);
	});

	it("anthropic: in was already fresh — unchanged; the miss estimate now runs on totals (OLD: never fired)", () => {
		// OLD: in = 5000 (fresh, as-is — unchanged), but the miss estimate
		// was min(5000, 5000) − 45000 = −40000 → below the floor → silent.
		// NEW: total = 5000 + 45000 = 50000 → min(50000, 50000) − 45000 = 5000.
		const d = usageFromEvent("anthropic", event({ inputTokens: 5000, cacheRead: 45000, outputTokens: 100 }), 50000);
		expect(d.usage.in).toBe(5000);
		expect(d.missed).toBe(5000);
	});

	it("the route fallback is the total convention (the tracer's 'adapter' fallback, by construction)", () => {
		// a session without a provider resolves like the trace path's
		// unknown-route fallback — total convention, never a crash.
		const d = usageFromEvent(undefined, event({ inputTokens: 111, cacheRead: 1024, outputTokens: 50 }), null);
		expect(d.usage.in).toBe(0);
		expect(d.usage.cache).toBe(1024);
	});

	it("below the 1024-token floor the miss is noise — not surfaced", () => {
		const d = usageFromEvent("openai-compat", event({ inputTokens: 50000, cacheRead: 49400, outputTokens: 100 }), 50000);
		expect(d.missed).toBe(null); // min − cache = 600 < 1024
	});

	it("an unknown-usage event cannot corrupt the bookkeeping — the carrier recovers (OLD: null forever)", () => {
		const unknown = event({ known: false, inputTokens: null, outputTokens: null, cacheRead: null, cacheWrite: null });
		const d1 = usageFromEvent("openai-compat", unknown, null);
		// the canonical "0 = unknown" convention (the guard's quartet shape);
		// known:false suppresses every render, so the zeros are invisible
		//
		// DECLARED SUPERSESSION (DF-0322-F2, 0.34.0): `cache` was 0 here. The
		// display is now handed the PROVIDER'S OWN WORD rather than the
		// canonical figure, and an unknown-usage event reported nothing about
		// caching — so the field is null. `in` and `out` keep the canonical
		// zeros: this round changed the cache field alone, which is where the
		// row was claiming a measurement that never happened. Incidental to
		// what this case tests, which is that the CARRIER RECOVERS on the next
		// known event — unchanged and still asserted below.
		expect(d1.usage).toEqual({ in: 0, out: 0, cache: null, known: false });
		expect(d1.missed).toBe(null);
		// the NEXT known turn: the carrier is fresh again → the signal fires
		const d2 = usageFromEvent("openai-compat", df2(), d1.total);
		expect(d2.missed).toBe(null); // min(1978, 1978) − 1920 = 58 < 1024
		expect(d2.total).toBe(1978);
	});

	it("an above-floor miss on the df2 shape fires", () => {
		// a 90%-hit turn: total 50000, cache 45000 → miss 5000; then a
		// 70%-hit turn: total 50000, cache 35000 → miss 15000.
		const d1 = usageFromEvent("openai-compat", event({ inputTokens: 50000, cacheRead: 35000, outputTokens: 100 }), 50000);
		expect(d1.missed).toBe(15000);
	});
});

describe("W22 (owner, 2026-09-14) — the TURN's usage is the SUM of its calls", () => {
	it("nine calls: the row carries the turn's fresh and output, not the ninth call's", () => {
		// The owner's own dogfood, verbatim (DeepSeek V4.1 Flash, 2026-09-14):
		// a nine-call turn whose LAST call read 21,276 tokens (20,864 of them
		// cached → 412 fresh) and wrote 924. The old scope reported exactly
		// that — "in 412 out 924 · cache 98%" — for a turn that had spent
		// 120,358 prompt tokens and 4,608 output tokens, and every reader
		// (the owner included) read it as the turn's.
		const calls: ReadonlyArray<readonly [number, number, number]> = [
			[2857, 2688, 226],
			[7856, 3072, 314],
			[10722, 8064, 95],
			[12544, 10752, 312],
			[13600, 12800, 634],
			[15146, 14208, 620],
			[16371, 15744, 535],
			[19986, 16896, 948],
			[21276, 20864, 924],
		];
		let acc: import("@vincemakes/kiso-tui").RunUsage | null = null;
		for (const [inputTokens, cacheRead, outputTokens] of calls) {
			const d = usageFromEvent("openai-compat", event({ inputTokens, cacheRead, outputTokens }), null);
			acc = acc === null ? d.usage : accumulateUsage(acc, d.usage);
		}
		// fresh 15,270 (the input the turn bought at full price), out 4,608,
		// cache 105,088 — the recap renders the first two and the RATIO of the
		// third (cache/(in+cache) = 87%), never the raw sum: a sum over calls
		// counts the same prefix once per call.
		expect(acc).toEqual({ in: 15270, out: 4608, cache: 105088, known: true });
	});

	it("a single call is the sum, not an addition to nothing (the first call is not double-counted)", () => {
		const d = usageFromEvent("openai-compat", df2(), null);
		expect(d.usage).toEqual({ in: 58, out: 111, cache: 1920, known: true });
	});

	it("an unmeasured term makes the sum unmeasured (OR-10's rule, applied to the sum)", () => {
		// call 1 has no cache figure (a backend that does not report one), call
		// 2 does: the turn's cache figure is UNKNOWN, never the 2,000 the sum
		// of the known part would claim.
		const d1 = usageFromEvent("openai-compat", event({ inputTokens: 1000, cacheRead: null, outputTokens: 10 }), null);
		const d2 = usageFromEvent("openai-compat", event({ inputTokens: 3000, cacheRead: 2000, outputTokens: 10 }), null); // 3000 − 2000 = 1000 fresh
		const acc = accumulateUsage(d1.usage, d2.usage);
		expect(acc.cache).toBeNull();
		expect(acc.in).toBe(2000); // fresh is measured on both calls — summed
		expect(acc.out).toBe(20);
		expect(acc.known).toBe(true);
	});

	it("one call without usage makes the whole turn unknown — never a lower bound read as a total", () => {
		const known = usageFromEvent("openai-compat", df2(), null);
		const unknown = usageFromEvent("openai-compat", event({ known: false, inputTokens: null, outputTokens: null, cacheRead: null, cacheWrite: null }), null);
		expect(accumulateUsage(known.usage, unknown.usage).known).toBe(false);
	});
});

describe("OR-1 — the endpoint decides the price the status row adds", () => {
	it("a subscription run of gpt-5.5 carries a null cost; the first-party run carries the page's rate", () => {
		const ev = event({ inputTokens: 1_000_000, cacheRead: 0, outputTokens: 1_000_000 });
		// the ChatGPT backend's row has pricing: null — a subscription is not billed per token
		expect(usageFromEvent("openai-responses", ev, null, "gpt-5.5", "https://chatgpt.com/backend-api").costUsd).toBeNull();
		// the first-party row: $5 in + $30 out per 1M (the model page, 2026-09-08)
		expect(usageFromEvent("openai-responses", ev, null, "gpt-5.5", "https://api.openai.com/v1").costUsd).toBeCloseTo(35, 9);
	});
});

describe("OR-10 (owner, 2026-09-09) — no cache meter where the backend's figure carries no information", () => {
	it("the same event on the ChatGPT backend carries a null cache and no miss; on the first-party endpoint, the numbers", () => {
		// the ChatGPT backend answers cached_tokens 0 to a third-party client
		// on every request (the 2026-09-09 probe: three identical 1,922-token
		// requests, one prompt_cache_key, 0 at every attribution level) — its
		// 0 and "not reported" are one value, so the row declares the figure
		// unobservable and the display shows none. The record keeps the 0.
		const ev = event({ inputTokens: 5_000, cacheRead: 0, outputTokens: 100 });
		const sub = usageFromEvent("openai-responses", ev, 20_000, "gpt-6-astra", "https://chatgpt.com/backend-api");
		expect(sub.usage.cache, "the backend's 0 is not a measurement").toBeNull();
		expect(sub.missed, "no miss can be derived from an unobserved figure").toBeNull();
		expect(sub.usage.in, "the fresh input is still what it was").toBe(5_000);
		expect(sub.usage.known).toBe(true);
		// the first-party endpoint reports real hits above its 1,024-token
		// floor: its 0 is a measurement and the miss is derived from it
		const api = usageFromEvent("openai-responses", ev, 20_000, "gpt-6-astra", "https://api.openai.com/v1");
		expect(api.usage.cache).toBe(0);
		expect(api.missed).toBe(5_000);
	});
});
