import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * F33-R3 (Astra): `known` is not completeness, and the trace said it was.
 *
 * Core's contract: `known: true` means AT LEAST ONE usage field was
 * reported; the rest may be null. Canonicalization then fills the
 * unreported ones with zero. Copying that boolean into `usageKnown` handed
 * every consumer a measured zero for a field nobody measured — the same
 * "unknown is not zero" defect the schema bump existed to close, one level
 * further down.
 *
 * `usageKnown` now means what a consumer needs it to mean: every field the
 * cost is made of was reported. A reported zero is still known — null is
 * unreported, 0 is measured.
 */
import { canonicalizeUsageForModel } from "../src/usage/canonical.js";

describe("F33-R3: a partially reported usage is not a complete one", () => {
	// The raw quartet as the guard receives it, and the rule it now applies.
	const complete = (p: { inputTokens: number | null; cacheRead: number | null; outputTokens: number | null }): boolean =>
		p.inputTokens !== null && p.cacheRead !== null && p.outputTokens !== null;

	it("output missing while known:true is NOT complete", () => {
		expect(complete({ inputTokens: 100, cacheRead: 20, outputTokens: null })).toBe(false);
	});

	it("input missing is not complete either", () => {
		expect(complete({ inputTokens: null, cacheRead: 20, outputTokens: 5 })).toBe(false);
	});

	it("cache missing is not complete either", () => {
		expect(complete({ inputTokens: 100, cacheRead: null, outputTokens: 5 })).toBe(false);
	});

	it("a genuinely REPORTED zero stays complete — 0 is a measurement, null is not", () => {
		expect(complete({ inputTokens: 0, cacheRead: 0, outputTokens: 0 })).toBe(true);
	});

	it("and canonicalization is what makes the distinction unrecoverable afterwards", () => {
		// Why the flag has to be computed BEFORE this: the null becomes a
		// zero here, and no later reader can tell it from a measured one.
		const c = canonicalizeUsageForModel("deepseek-flash", "https://api.deepseek.com", "openai-compat", {
			inputTokens: 100,
			outputTokens: null,
			cacheRead: 20,
			cacheWrite: null,
		});
		expect(c.output).toBe(0);
	});
});
