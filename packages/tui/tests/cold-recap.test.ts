/**
 * 0.40.0 (the owner) — a turn after a long idle names its cold cache.
 *
 * `fresh 730k · cache 0% · miss 727k` is true and reads like a fault. When
 * the caller says the turn began on a cold cache, the recap says so: the
 * gap and the re-read are the facts and stand first; "cache cold after" is
 * the label, and the first thing shed when the row is narrow.
 */

import { describe, expect, it } from "vitest";
import { visibleWidth } from "@vincemakes/kiso-tui-cells/width";
import { renderRecap } from "../src/lines.js";

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
const cold = { seconds: 12, usage: { known: true, in: 735_000, out: 1_200, cache: 3_456 }, missed: 727_000, ctxLeftPct: 27, coldAfterMinutes: 58 };

describe("the cold-cache recap", () => {
	it("names the gap and the re-read instead of a bare fresh figure", () => {
		expect(plain(renderRecap(cold as never))).toBe("✦ took 12s · cache cold after 58 min · re-read 727k · out 1.2k · ctx left ~27%");
	});

	it("re-read falls back to the turn's fresh input when no miss was surfaced", () => {
		const { missed: _m, ...noMiss } = cold;
		expect(plain(renderRecap(noMiss as never))).toContain("re-read 735k");
	});

	it("a narrow row sheds the label before the cut reaches a fact", () => {
		const out = plain(renderRecap({ ...cold, width: 60 } as never));
		expect(visibleWidth(out)).toBeLessThanOrEqual(60);
		expect(out).toContain("cold 58 min");
		expect(out).toContain("re-read 727k");
		expect(out).not.toContain("cache cold after");
	});

	it("without the cold field the recap is byte-for-byte the historical form", () => {
		const { coldAfterMinutes: _c, ...warm } = cold;
		expect(plain(renderRecap(warm as never))).toBe("✦ took 12s · fresh 735k out 1.2k · cache 0% · miss 727k · ctx left ~27%");
	});
});
