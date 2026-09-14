import { describe, expect, it } from "vitest";
import { idleStatus, runningStatus } from "../src/status.js";

/**
 * A PERCENTAGE NEEDS A DENOMINATOR.
 *
 * `ctx left ~82%` was printed against a hardcoded 200,000 whenever the
 * model's real window was unknown — which is every DeepSeek session, since
 * the vendor publishes no window, its /models endpoint returns ids only,
 * and the registry records null on purpose. A reader had no way to tell
 * that percentage from one computed against a real window.
 *
 * The row's own rule, written on the token-rate beside it, is that a number
 * here is a measurement or it is absent. This applies it to the context
 * estimate: a known window gives a percentage, an unknown one gives `ctx ?`.
 */
describe("the context segment says `?` rather than a percentage of a guess", () => {
	it("a known window still prints the percentage, unchanged", () => {
		expect(idleStatus("bypass", "m", 0.18)).toContain("ctx left ~82%");
		expect(runningStatus("✦", Date.now() - 3000, 100, 0.18)).toContain("ctx left ~82%");
	});

	it("an unknown window prints `ctx ?` on BOTH rows — never a percentage, never `~null%`", () => {
		for (const row of [idleStatus("bypass", "m", Number.NaN), runningStatus("✦", Date.now() - 3000, 100, Number.NaN)]) {
			expect(row).toContain("ctx ?");
			expect(row).not.toContain("null");
			expect(row).not.toMatch(/ctx left ~\d+%/);
		}
	});

	it("the rest of the row is untouched when the window is unknown", () => {
		// The context estimate going quiet must not take the model name, the
		// tier or the token rate with it.
		const row = idleStatus("bypass", "deepseek-flash", Number.NaN, { tokPerSec: 183, cacheHitPct: 98, costUsd: null });
		expect(row).toContain("deepseek-flash");
		expect(row).toContain("183 tok/s");
		expect(row).toContain("CH 98%");
	});
});
