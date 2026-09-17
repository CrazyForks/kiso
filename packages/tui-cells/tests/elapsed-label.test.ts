/**
 * The elapsed label — one form, used everywhere a duration is shown live.
 *
 * The status row said "working 637s". Ten minutes of work read as a
 * four-figure number, and the same duration on a settled card read the
 * same way, because `${elapsed}s` was written out at nine call sites and
 * none of them knew about the others.
 *
 * WHY THIS IS NOT A SECOND FORMATTER. `formatDuration` (W20) already
 * produced `37s` / `1m 1s` / `2h 14m` for the task block, which is this
 * shape in every branch except the hour one, where it drops seconds. A
 * near-copy differing in one branch is exactly the drift that "one
 * helper" exists to prevent, so the branch is a PARAMETER and both
 * idioms come from one implementation.
 *
 * W20's own form is unchanged and pinned below: the task narrative's
 * long-horizon idiom is a settled decision and is not in this round.
 *
 * NOTE ON THE FIXTURES. Every duration pinned in the suite before this
 * change was under a minute — 35 of them, none at 60 or above. That is
 * why "637s" could exist: the branch that produced it was never asserted
 * anywhere. The cases below are therefore NEW coverage, not adjusted
 * coverage.
 */

import { describe, expect, it } from "vitest";
import { elapsedLabel, formatDuration } from "../src/components.js";

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

	it("W20's own form is UNCHANGED — it drops seconds past an hour, deliberately", () => {
		expect(formatDuration(37)).toBe("37s");
		expect(formatDuration(61)).toBe("1m 1s");
		expect(formatDuration(8040)).toBe("2h 14m"); // the settled task idiom
	});

	it("the two agree everywhere they are supposed to — only the hour branch differs", () => {
		for (const s of [0, 1, 37, 59, 60, 61, 637, 3599]) {
			expect(elapsedLabel(s), `${s}s`).toBe(formatDuration(s));
		}
		expect(elapsedLabel(3723)).not.toBe(formatDuration(3723));
	});
});
