/**
 * The elapsed label — one form, used everywhere a duration is shown live.
 *
 * The status row said "working 637s". Ten minutes of work read as a
 * four-figure number, and the same duration on a settled card read the
 * same way, because `${elapsed}s` was written out at nine call sites and
 * none of them knew about the others.
 *
 * 0.44.0: the other duration form, the task block's `2h 14m`, left with
 * the task extension (the retired checklist was its only caller). This
 * label no longer shares an implementation with anything.
 *
 * 0.39.1 — THE SWEEP THAT DID NOT HAPPEN. The helper landed in 0.39.0
 * and two of nine call sites were converted: the ones in the diff being
 * written, which held the duration in a local called `elapsed`. The
 * status row itself — the row that started the item — was in another
 * package under another name and was missed, along with the settled
 * card's ladders. `tests/one-duration-form.test.ts` is the oracle for
 * that, because an inconsistency has none of its own.
 *
 * The settled sites turned out NOT to be this form: a finished call
 * reports to a tenth (R13's `exit 0 · 90 lines · 0.4s`), which a running
 * clock cannot know. `settledLabel` keeps the tenth and hands over to
 * the live label past a minute, where `734.2s` was the same unreadable
 * number by another route.
 *
 * NOTE ON THE FIXTURES. Every duration pinned in the suite before this
 * change was under a minute — 35 of them, none at 60 or above. That is
 * why "637s" could exist: the branch that produced it was never asserted
 * anywhere. The cases below are therefore NEW coverage, not adjusted
 * coverage.
 */

import { describe, expect, it } from "vitest";
import { elapsedLabel, settledLabel } from "../src/components.js";

describe("elapsedLabel", () => {
	it("under a minute is bare seconds", () => {
		expect(elapsedLabel(0)).toBe("0s");
		expect(elapsedLabel(37)).toBe("37s");
		expect(elapsedLabel(59)).toBe("59s");
	});

	it("from a minute, minutes and seconds", () => {
		expect(elapsedLabel(60)).toBe("1m 0s");
		expect(elapsedLabel(61)).toBe("1m 1s");
		expect(elapsedLabel(637)).toBe("10m 37s"); // the row the owner saw
		expect(elapsedLabel(3599)).toBe("59m 59s");
	});

	it("from an hour, hours AND minutes AND seconds", () => {
		expect(elapsedLabel(3600)).toBe("1h 0m 0s");
		expect(elapsedLabel(3723)).toBe("1h 2m 3s");
		expect(elapsedLabel(86_399)).toBe("23h 59m 59s");
	});

	it("rounds and never goes negative — a clock skew is not a negative duration", () => {
		expect(elapsedLabel(36.6)).toBe("37s");
		expect(elapsedLabel(-5)).toBe("0s");
	});

	it("settledLabel keeps the tenth under a minute — nothing a fixture pinned moves", () => {
		expect(settledLabel(0)).toBe("0.0s");
		expect(settledLabel(0.42)).toBe("0.4s");
		expect(settledLabel(12.75)).toBe("12.8s");
		expect(settledLabel(59.9)).toBe("59.9s");
	});

	it("settledLabel hands over to the live label past a minute", () => {
		expect(settledLabel(60)).toBe("1m 0s");
		expect(settledLabel(734.2)).toBe("12m 14s"); // was `734.2s`
		expect(settledLabel(3723)).toBe("1h 2m 3s");
	});

	it("settledLabel never goes negative either", () => {
		expect(settledLabel(-5)).toBe("0.0s");
	});
});
