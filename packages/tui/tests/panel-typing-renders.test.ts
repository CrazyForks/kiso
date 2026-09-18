/**
 * 0.40.0 dogfood item 6 — a key typed into a panel's text field asks for
 * a frame.
 *
 * Measured before the fix (real PTY, KISO_TRACE_BYTES): in the ask
 * panel's free-text field the first paint after a key landed anywhere in
 * 0–150 ms, uniformly — the key was inserted at once, but no frame was
 * requested; the text rode the next spinner/status tick. The cause:
 * `#refreshMenu` returned for a panel that is up BEFORE its render, and
 * insert/delete render only through it. With nothing moving, a typed
 * character would not appear at all until some other event.
 *
 * The gate: every key in a typed phase — ASCII, a CJK commit, a
 * multi-code-point IME commit, a backspace — calls the render hook.
 */

import { describe, expect, it } from "vitest";
import { Editor } from "../src/editor.js";
import { askView } from "../src/ask-panel.js";
import type { AskSpec, PanelView } from "../src/approval-panel.js";

const enc = (s: string) => new TextEncoder().encode(s);

const ASK_SPEC: AskSpec = {
	questions: [{ question: "which name?", options: [{ label: "a" }, { label: "b" }] }],
};

const APPROVAL_VIEW: PanelView = {
	flavor: "approval",
	name: "edit_file",
	title: "edit examples/foo.ts",
	speaker: "mode:default",
	hint: "/mode accept-edits auto-approves edits",
	statusText: "▸ run paused",
	args: { kind: "text", lines: ["old", "new"] },
	fallbackQuestion: "approve edit_file? (y/n) ",
};

/** Each key fed on its own, the render calls it caused counted. */
function rendersPerKey(view: PanelView, open: string, keys: readonly string[]): number[] {
	let renders = 0;
	const editor = new Editor(() => {
		renders += 1;
	});
	editor.beginPanel(view, () => {});
	editor.feed(enc(open));
	return keys.map((k) => {
		const before = renders;
		editor.feed(enc(k));
		return renders - before;
	});
}

const KEYS = ["h", "i", "\u5e2e", "\u6211", "\u9879\u76ee\u7ed3\u6784", "\x7f"];

describe("item 6 — a typed phase requests a frame on every key", () => {
	it("the ask panel's free-text field (t): ASCII, CJK, a multi-character commit, backspace", () => {
		const per = rendersPerKey(askView(ASK_SPEC), "t", KEYS);
		expect(per.every((n) => n >= 1), `render calls per key ${JSON.stringify(per)}`).toBe(true);
	});

	it("the approval panel's amend line (tab)", () => {
		const per = rendersPerKey(APPROVAL_VIEW, "\t", KEYS);
		expect(per.every((n) => n >= 1), `render calls per key ${JSON.stringify(per)}`).toBe(true);
	});

	it("the composer with no panel keeps its one render per key (the control)", () => {
		let renders = 0;
		const editor = new Editor(() => {
			renders += 1;
		});
		const per = KEYS.map((k) => {
			const before = renders;
			editor.feed(enc(k));
			return renders - before;
		});
		expect(per.every((n) => n >= 1), `render calls per key ${JSON.stringify(per)}`).toBe(true);
	});
});
