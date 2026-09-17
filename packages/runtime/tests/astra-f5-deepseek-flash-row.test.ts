import { describe, expect, it } from "vitest";
import { lookupModelMetadata, resolveReasoning } from "../src/provider/metadata.js";

const DS = "https://api.deepseek.com";

/**
 * Astra F5 — THE VENDOR'S CURRENT RECOMMENDED ID HAD NO ROW.
 *
 * Copying `deepseek-flash` out of the vendor's own documentation silently
 * cost the effort controls: an unregistered model resolves default/default
 * to an empty wire setting but REFUSES an explicit level by name. That
 * refusal is correct — unknown stays unknown — but it was being reached for
 * the wrong reason. The model is known; the registry had not been told its
 * current name.
 *
 * The legacy alias is retained, not replaced: the vendor still accepts it.
 */
describe("F5: deepseek-flash is registered, dated and sourced", () => {
	it("the canonical id resolves at the vendor's endpoint", () => {
		const row = lookupModelMetadata("deepseek-flash", DS);
		expect(row).not.toBeNull();
		expect(row?.providerId).toBe("deepseek");
		expect(row?.endpoint).toBe(DS);
	});

	it("an explicit native level is ACCEPTED, which is the whole point", () => {
		for (const effort of ["low", "high", "max"] as const) {
			const r = resolveReasoning("deepseek-flash", { thinking: "default", effort }, DS);
			expect(r.ok, `${effort}: ${r.ok ? "" : r.reason}`).toBe(true);
		}
	});

	it("a level OUTSIDE the native list is still refused by name — the row does not widen what is legal", () => {
		const r = resolveReasoning("deepseek-flash", { thinking: "default", effort: "xhigh" }, DS);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toContain("low");
	});

	it("the legacy id still resolves — an alias the vendor accepts is not removed", () => {
		expect(lookupModelMetadata("deepseek-v4-flash", DS)).not.toBeNull();
		expect(resolveReasoning("deepseek-v4-flash", { thinking: "default", effort: "high" }, DS).ok).toBe(true);
	});

	it("the two rows agree on capabilities — the canonical name is not a different model", () => {
		const a = lookupModelMetadata("deepseek-flash", DS)?.capabilities;
		const b = lookupModelMetadata("deepseek-v4-flash", DS)?.capabilities;
		expect(a?.reasoning?.effort).toEqual(b?.reasoning?.effort);
		expect(a?.reasoning?.thinking).toEqual(b?.reasoning?.thinking);
		expect(a?.promptCaching).toBe(b?.promptCaching);
	});

	/**
	 * DECLARED SUPERSESSION (REG-1, 2026-09-17) — this assertion used to
	 * read: "NO number is invented: the window and the price stay null",
	 * with the reason "a figure read off a page is not a measurement, and
	 * this row decides when context relief fires".
	 *
	 * BOTH HALVES OF THAT WERE WRONG, and the second is why it mattered.
	 *
	 * The standard was stricter than this registry's own contract. A DATED
	 * VENDOR STATEMENT is the footing every Anthropic and OpenAI row stands
	 * on — `capabilitiesAsOf` and `capabilitiesSource` exist for exactly
	 * that. Applying a harder rule to one provider excluded our own model
	 * from the rule everyone else lives under.
	 *
	 * And "this row decides when context relief fires" was the argument FOR
	 * filling it, not against. A null window does not make the product
	 * cautious; it sends `contextWindowTokens` to its 200,000 fallback, and
	 * the compaction threshold is half of that — so the product cleared a
	 * 1M-context model at 100,000 tokens, a TENTH of its capacity, and the
	 * only symptom anyone could see was `ctx ?` in the status line. CTX-1
	 * priced early compaction at +29.6%.
	 *
	 * The row now carries what the vendor states, dated, from the same page
	 * the reasoning block already cited.
	 */
	it("the window and price are the vendor's dated statement, not a guess and not a null", () => {
		const row = lookupModelMetadata("deepseek-flash", DS);
		expect(row?.capabilities.contextWindow).toBe(1_000_000);
		expect(row?.capabilities.maxOutputTokens).toBe(384_000);
		expect(row?.pricing).not.toBeNull();
		// OFF-PEAK: the vendor publishes two sets and `ModelPricing` has one,
		// so the row carries off-peak and the doubling is stated in the
		// metadata comment rather than by inventing a field.
		expect(row?.pricing?.inputPerM).toBe(0.15);
		expect(row?.pricing?.outputPerM).toBe(0.6);
		expect(row?.pricing?.cacheReadPerM).toBe(0.003);
		expect(row?.capabilitiesAsOf).toBe("2026-09-17");
		expect(row?.capabilitiesSource).toContain("api-docs.deepseek.com");
	});

	it("an id nobody registered still behaves as before — default/default passes, a named level refuses", () => {
		expect(lookupModelMetadata("deepseek-not-a-real-name", DS)).toBeNull();
		expect(resolveReasoning("deepseek-not-a-real-name", { thinking: "default", effort: "default" }, DS).ok).toBe(true);
		expect(resolveReasoning("deepseek-not-a-real-name", { thinking: "default", effort: "high" }, DS).ok).toBe(false);
	});
});
