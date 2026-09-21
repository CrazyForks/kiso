/**
 * DC-58 — the /model picker SCROLLS: every profile is reachable by ↑↓.
 *
 * The owner, 2026-09-21: with a sixty-profile config `/model` showed nine
 * and the rest could only be reached by typing the name — "we must support
 * ↑↓ to look through all the models". The cause was three places sharing
 * one assumption: PICK_MAX was the REACH (the cursor's bound and the digit
 * range), not merely the window (`approval-panel.ts`, the fixed
 * `slice(0, min(budget, PICK_MAX))`).
 *
 * The contract now, asserted here:
 *   - ↑↓ walk EVERY option;
 *   - the window follows the cursor (`pickWindow`) and the block says which
 *     rows are on screen (`↕ A-B / N — ↑↓ scrolls`);
 *   - a digit names the row ON SCREEN, so what the row shows and what the
 *     key does are the same position.
 *
 * 0.40.1 (the owner's dogfood, the same day): the rows carry NO number and no
 * `profile: <key>` note. The labels are what a chooser reads; the digits are
 * still a shortcut by visible position, which is why the position assertions
 * below stay (they are what the keys mean) while the row assertions are about
 * labels.
 */

import { describe, expect, it } from "vitest";
import { Editor } from "../src/editor.js";
import { panelRowsOf } from "../src/ask-panel.js";
import { modelPickView, PICK_MAX, pickWindow, type PickSpec } from "../src/approval-panel.js";

const enc = (s: string) => new TextEncoder().encode(s);
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** N profiles, in the shape the CLI builds them (label + note). */
function many(n: number): PickSpec {
	return {
		header: "model — current: deepseek-v4-flash (openai-compat)",
		options: Array.from({ length: n }, (_, i) => ({ label: `model-${i + 1}`, note: `profile: p${i + 1}` })),
		typeHint: "type provider/model directly",
	};
}

/** The panel state the compositor would hand the renderer for this cursor.
 *  maxRows 24 puts the budget above PICK_MAX, so the window is PICK_MAX
 *  rows — the same size the editor's own 24-row terminal gives it. */
function rows(cursor: number, n = 60): string[] {
	const view = modelPickView(many(n), "▸ idle");
	return panelRowsOf({ view, phase: "options", cursor, pick: { cursor, phase: "options", level: null } }, 80, 24).map(strip);
}

/** The option rows as drawn: their labels in order, and the cursor's row. */
function drawn(rs: readonly string[]): { labels: string[]; cursorRow: string | null } {
	const labels: string[] = [];
	let cursorRow: string | null = null;
	for (const r of rs) {
		const m = /(model-\d+)/.exec(r);
		if (m === null) continue;
		labels.push(m[1]!);
		if (r.includes("\u2192")) cursorRow = r;
	}
	return { labels, cursorRow };
}

describe("DC-58 — pickWindow: the window follows the cursor", () => {
	it("edge-following: the window moves only when the cursor leaves it", () => {
		expect(pickWindow(0, 60, 9), "the opening screen starts at the first option").toEqual({ first: 0, size: 9 });
		expect(pickWindow(8, 60, 9), "the ninth row is still inside the first screen").toEqual({ first: 0, size: 9 });
		expect(pickWindow(9, 60, 9), "the tenth row scrolls it by exactly one").toEqual({ first: 1, size: 9 });
		expect(pickWindow(30, 60, 9)).toEqual({ first: 22, size: 9 });
	});

	it("clamped at both ends: the last screen is FULL, never short", () => {
		expect(pickWindow(59, 60, 9)).toEqual({ first: 51, size: 9 });
		expect(pickWindow(60, 60, 9), "a cursor past the end cannot drag the window past it either").toEqual({ first: 51, size: 9 });
	});

	it("a list shorter than the window is the window", () => {
		expect(pickWindow(0, 3, 9)).toEqual({ first: 0, size: 3 });
		expect(pickWindow(2, 3, 9)).toEqual({ first: 0, size: 3 });
		expect(pickWindow(0, 0, 9), "nothing to show is a window of one, not of zero").toEqual({ first: 0, size: 1 });
	});
});

describe("DC-58 — the block draws the window and names the rows on screen", () => {
	it("sixty profiles: the first screen is the first nine rows, and the block SAYS so", () => {
		const d = drawn(rows(0));
		expect(d.labels).toEqual(["model-1", "model-2", "model-3", "model-4", "model-5", "model-6", "model-7", "model-8", "model-9"]);
		expect(rows(0).join("\n"), "the range names the window, and the gesture that moves it").toContain("↕ 1-9 / 60 — ↑↓ scrolls");
		expect(rows(0).join("\n"), "the old sentence sent you to type the name; the list scrolls now").not.toContain("takes any of them");
	});

	it("walking past the ninth row scrolls the window — and the cursor row is never off screen", () => {
		const d = drawn(rows(12)); // the thirteenth option
		expect(d.cursorRow, "the cursor's option is DRAWN").toContain("model-13");
		expect(d.labels).toEqual(["model-5", "model-6", "model-7", "model-8", "model-9", "model-10", "model-11", "model-12", "model-13"]);
		expect(rows(12).join("\n")).toContain("↕ 5-13 / 60 — ↑↓ scrolls");
	});

	it("the last screen is full and the cursor sits on the last option", () => {
		const d = drawn(rows(59));
		expect(d.labels).toEqual(["model-52", "model-53", "model-54", "model-55", "model-56", "model-57", "model-58", "model-59", "model-60"]);
		expect(d.cursorRow).toContain("model-60");
	});

	it("a list that fits shows no range line at all", () => {
		expect(rows(0, 9).join("\n")).not.toContain("↕");
		expect(drawn(rows(0, 3)).labels).toEqual(["model-1", "model-2", "model-3"]);
	});

	it("0.40.1: a row is its LABEL — no number in front, no profile note behind", () => {
		const bare: PickSpec = {
			header: "model — current: x",
			options: Array.from({ length: 3 }, (_, i) => ({ label: `openai-compat/model-${i + 1} @api.example.com` })),
			typeHint: "type provider/model directly",
		};
		const rs = panelRowsOf({ view: modelPickView(bare, "▸ idle"), phase: "options", cursor: 0, pick: { cursor: 0, phase: "options", level: null } }, 80, 24).map(strip);
		const text = rs.join("\n");
		expect(text, "the label, not `1 <label>`").toContain("openai-compat/model-1 @api.example.com");
		expect(text, "no digit column").not.toMatch(/\d+ openai-compat/);
		expect(text, "and no per-row profile key").not.toContain("profile:");
	});
});

describe("DC-58 — the keys: ↑↓ reach every option, a digit names a ROW", () => {
	function open(n = 60) {
		const seen: unknown[] = [];
		const editor = new Editor(() => {});
		editor.beginPanel(modelPickView(many(n), "▸ idle"), (v) => seen.push(v));
		return { editor, seen };
	}

	it("↑↓ walk past the ninth option — the bound is the LIST, not PICK_MAX", () => {
		const { editor } = open();
		editor.feed(enc("\x1b[B".repeat(12)));
		expect(editor.panelState()!.pick!.cursor, "the thirteenth option, which this picker could not reach before").toBe(12);
		editor.feed(enc("\x1b[B".repeat(60)));
		expect(editor.panelState()!.pick!.cursor, "and the end of the list is the end, not row nine").toBe(59);
		editor.feed(enc("\x1b[A".repeat(3)));
		expect(editor.panelState()!.pick!.cursor).toBe(56);
	});

	it("a digit names the row ON SCREEN: after scrolling, `1` is the first VISIBLE option", () => {
		const { editor, seen } = open();
		editor.feed(enc("\x1b[B".repeat(12)));
		const first = pickWindow(12, 60, PICK_MAX).first;
		expect(first, "the window really did scroll").toBe(4);
		editor.feed(enc("1"));
		expect(editor.panelState()!.pick!.cursor, "row 1 of the screen is option 5").toBe(first);
		editor.feed(enc("\r"));
		expect(seen).toEqual([{ action: "picked", result: { index: first } }]);
	});

	it("a digit beyond the window is inert — never a pick nobody aimed at", () => {
		const { editor } = open(4); // four options, window four
		editor.feed(enc("9"));
		expect(editor.panelState()!.pick!.cursor, "no option nine exists").toBe(0);
		editor.feed(enc("4"));
		expect(editor.panelState()!.pick!.cursor).toBe(3);
	});

	it("a short list still behaves exactly as it did (three profiles, digits 1-3)", () => {
		const { editor, seen } = open(3);
		editor.feed(enc("2"));
		expect(editor.panelState()!.pick!.cursor).toBe(1);
		editor.feed(enc("\r"));
		expect(seen).toEqual([{ action: "picked", result: { index: 1 } }]);
	});
});
