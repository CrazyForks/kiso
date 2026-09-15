/**
 * KC2 §5 — the status-line FORMATTERS, extracted from the CLI (the
 * ADR-0041 escape hatch: extraction, never a raise). The rows are pinned
 * here byte-for-byte because the e2e transcripts match them by substring:
 * the idle row is UNCHANGED by the move, and the running row's only
 * change is the KC2 §2 hint that names the new gesture.
 */
import { describe, expect, it } from "vitest";
import { STATUS_GLYPHS, idleStatus, runningStatus } from "../src/status.js";

describe("KC2 §5: the idle status row (byte-identical to the pre-extraction CLI)", () => {
	it("names the tier, the /mode hint, the model and the ctx estimate", () => {
		expect(idleStatus("default", "faux", 0.25)).toBe("▸ default · /mode to switch · faux · ctx left ~75%");
	});

	it("takes the tier as GIVEN — the caller spells plan's posture, the formatter never guesses", () => {
		// chat spells it out (W19); the recovery flow passes the bare mode —
		// the move must not silently unify them.
		expect(idleStatus("plan (read-only)", "faux", 0)).toContain("▸ plan (read-only) · /mode to switch");
		expect(idleStatus("plan", "faux", 0)).toContain("▸ plan · /mode to switch");
	});

	it("a non-finite ratio prints `ctx ?`, never an invented number", () => {
		// The rule this case has always been about is unchanged: a row with
		// no window does NOT get to print a percentage. Only the wording
		// moved — `~null%` said it to a reader who knew the internals, and
		// `ctx ?` says it to everyone.
		//
		// The invented number is the failure it guards, and that failure was
		// live until 2026-09-14: the window fell back to a hardcoded 200,000
		// whenever a model published none, so every DeepSeek session printed
		// a confident `ctx left ~82%` computed against a figure nobody had
		// measured.
		const row = idleStatus("default", "faux", Number.NaN);
		expect(row).toBe("▸ default · /mode to switch · faux · ctx ?");
		expect(row).not.toMatch(/~\d+%/);
	});
});

describe("KC2 §5/§2: the running status row", () => {
	it("carries the glyph, the wall seconds, the token count and the ctx estimate", () => {
		const row = runningStatus("▖", Date.now() - 3_000, 1234, 0.1);
		expect(row).toMatch(/^▖ working 3s ↓ 1\.2k tokens · /);
		expect(row).toContain("ctx left ~90%");
	});

	it("a run that just started still reads 1s — the row never says 0s", () => {
		expect(runningStatus("▘", Date.now(), null, 0)).toMatch(/^▘ working 1s · /);
	});

	it("omits the token segment while the output count is unknown", () => {
		expect(runningStatus("▝", Date.now(), null, 0)).not.toContain("tokens");
	});

	it("KC2 §2 — the hint names BOTH gestures: esc stops, alt+⏎ redirects", () => {
		const row = runningStatus("▗", Date.now(), null, 0.5);
		expect(row).toContain("· esc stop · alt+⏎ redirect ·");
	});

	it("the row still satisfies the v2d transcript gate's shape", () => {
		// apps/cli/tests/tui-v2d.test.ts matches /^[✧✦✶✸✺] working \d+s.*$/ —
		// every glyph in the family must produce it.
		for (const g of STATUS_GLYPHS) expect(runningStatus(g, Date.now(), null, 0)).toMatch(/^[✧✦✶✸✺] working \d+s.*$/);
	});
});

describe("KC2 §5: the working glyph family", () => {
	// DECLARED SUPERSESSION (R3, design §5.2): the four quadrant blocks
	// are retired for the TWINKLE. Two reasons, both in the contract:
	// §5.3 forbids a mark that ROTATES on a call whose duration cannot be
	// predicted (it implies progress the product does not have), and §4.1
	// wants the running mark to be the mark that STAYS — the twinkle
	// settles onto `✦`, which is what a folded segment keeps.
	it("is design §5.2's seven-frame twinkle, settling on the fold's own mark", () => {
		expect([...STATUS_GLYPHS]).toEqual(["✧", "✦", "✶", "✸", "✺", "✸", "✦"]);
		expect(STATUS_GLYPHS[STATUS_GLYPHS.length - 1]).toBe("✦"); // §4.1: it settles where the fold lives
		expect(STATUS_GLYPHS).toHaveLength(7); // §5.1: seven steps of the 200ms tick = 1.4s
	});
});
