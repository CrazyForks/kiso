/**
 * 0.40.0 — the compacting row shows how much of the summary's OUTPUT budget
 * has been spent:
 *
 *   ▘ compacting · 6 rounds · ~95.1k → ▰▰▰▱▱▱ 4.2k/32k · 4s
 *
 * The covered size and the bar are ONE fact (what goes in → how much has
 * come out of how much it may), placed where the covered size stood;
 * the elapsed seconds follow and the retry segment stays last. The bar's
 * fill rule is the `/context` bar's, through one helper.
 */
import { describe, expect, it } from "vitest";
import { displayWidth } from "@vincemakes/kiso-tui-cells/width";
import { compactingStatus } from "../src/status.js";
import { meterGlyphs } from "../src/context-ledger.js";

describe("0.40.0 — the compacting row's bar", () => {
	it("mid-call: covered → bar produced/budget, then the seconds", () => {
		expect(compactingStatus("▘", 6, 95_100, 4, undefined, null, { produced: 4_200, budget: 32_000, reasoningUnseen: false })).toBe(
			"▘ compacting · 6 rounds · ~95.1k → ▰▱▱▱▱▱ 4.2k/32k · 4s", // 4.2/32 of six cells rounds to one
		);
		expect(compactingStatus("▘", 6, 95_100, 9, undefined, null, { produced: 16_000, budget: 32_000, reasoningUnseen: false })).toBe(
			"▘ compacting · 6 rounds · ~95.1k → ▰▰▰▱▱▱ 16k/32k · 9s",
		);
	});

	it("zero and full", () => {
		expect(compactingStatus("▘", 6, 95_100, 0, undefined, null, { produced: 0, budget: 32_000, reasoningUnseen: false })).toContain("~95.1k → ▱▱▱▱▱▱ 0/32k");
		expect(compactingStatus("▘", 6, 95_100, 30, undefined, null, { produced: 32_000, budget: 32_000, reasoningUnseen: false })).toContain("~95.1k → ▰▰▰▰▰▰ 32k/32k");
	});

	it("reasoning the provider billed but never streamed is named after the figure", () => {
		expect(compactingStatus("▘", 6, 95_100, 12, undefined, null, { produced: 5_000, budget: 32_000, reasoningUnseen: true })).toBe(
			"▘ compacting · 6 rounds · ~95.1k → ▰▱▱▱▱▱ 5k/32k · incl. unstreamed reasoning · 12s",
		);
	});

	it("no budget on the call: the covered size alone, as before — the bar never invents a denominator", () => {
		expect(compactingStatus("▘", 6, 95_100, 4, undefined, null, { produced: 4_200, budget: null, reasoningUnseen: false })).toBe("▘ compacting · 6 rounds · ~95.1k tokens · 4s");
	});

	it("without progress the row is byte-identical to the seam's", () => {
		expect(compactingStatus("▘", 6, 95_100, 4, undefined, null, null)).toBe(compactingStatus("▘", 6, 95_100, 4));
		expect(compactingStatus("▘", 6, 95_100, 4)).toBe("▘ compacting · 6 rounds · ~95.1k tokens · 4s");
	});

	it("the retry segment stays LAST", () => {
		const row = compactingStatus("▘", 6, 95_100, 4, undefined, { attempt: 2, maxRetries: 10, code: "network", delayMs: 3_000, midStream: false } as never, {
			produced: 1_000,
			budget: 32_000,
			reasoningUnseen: false,
		});
		const bar = row.indexOf("32k");
		const secs = row.indexOf("· 4s");
		const retry = row.indexOf("retr");
		expect(bar).toBeGreaterThan(0);
		expect(secs).toBeGreaterThan(bar);
		expect(retry).toBeGreaterThan(secs);
	});

	it("one fill rule for both bars", () => {
		expect(meterGlyphs(0, 6)).toBe("▱▱▱▱▱▱");
		expect(meterGlyphs(0.5, 6)).toBe("▰▰▰▱▱▱");
		expect(meterGlyphs(1.4, 6)).toBe("▰▰▰▰▰▰");
		expect(meterGlyphs(Number.NaN, 6)).toBe("▱▱▱▱▱▱");
	});

	it("at 60 columns the row fits: the reasoning note gives way, the bar and the seconds stay", () => {
		const row = compactingStatus("▘", 40, 1_200_000, 312, 60, null, { produced: 20_000, budget: 32_000, reasoningUnseen: true });
		expect(displayWidth(row)).toBeLessThanOrEqual(60);
		expect(row).toContain("▰▰▰▰▱▱ 20k/32k");
		expect(row).toContain("312s");
		expect(row).not.toContain("unstreamed");
	});
});
