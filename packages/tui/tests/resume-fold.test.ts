/**
 * 4c — the resumed history's fold on the compositor.
 *
 * Owner-ruled constraints: the fold commits as ONE row and never expands
 * on screen; a resize reprint (route B) redraws that one row, never the
 * thousands of cells a long session holds; the ctrl+r viewer reads the
 * folded turns; nothing durable, no state of its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Body } from "../src/compositor.js";
import { Screen } from "./helpers/screen.js";

function harness(opts: { W: number; H: number }) {
	let W = opts.W;
	let H = opts.H;
	const screen = new Screen(W, H);
	const writes: string[] = [];
	const body = new Body({
		active: () => true,
		height: () => H,
		width: () => W,
		editCol: () => 1,
		write: (s) => {
			writes.push(s);
			screen.feed(s);
		},
	});
	return {
		body,
		screen,
		writes,
		setSize: (w: number, h: number) => {
			W = w;
			H = h;
			screen.resizeTo(w, { narrowing: "truncate-post-erase" });
		},
		tick: () => vi.advanceTimersByTime(100),
	};
}

/** One settled turn, driven exactly as the replay drives it. */
function turn(b: Body, i: number): void {
	b.userLine(`ask number ${i}`);
	b.toolStart("read_file", `c${i}`, { path: `file${i}.ts` });
	b.toolResult(`c${i}`, { content: "one\ntwo", isError: false, untimed: true });
	b.textAppend(`reply number ${i}.\n`);
	b.textEnd();
	b.endTurn(0);
}

beforeEach(() => {
	vi.useFakeTimers();
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
});
afterEach(() => {
	vi.useRealTimers();
});

describe("4c — the fold on the compositor", () => {
	it("the fold commits as ONE row; the folded turns are not on screen; the turns after it are", () => {
		const h = harness({ W: 80, H: 24 });
		h.body.enter();
		h.body.fold("2 earlier turns · ctrl+r to read", () => {
			turn(h.body, 1);
			turn(h.body, 2);
		});
		turn(h.body, 3);
		h.tick();
		const all = h.screen.allLines().join("\n");
		expect(all.match(/2 earlier turns · ctrl\+r to read/g)).toHaveLength(1);
		expect(all).not.toContain("ask number 1");
		expect(all).not.toContain("reply number 2");
		expect(all).toContain("ask number 3");
		expect(all).toContain("reply number 3");
	});

	it("a replayed card says nothing about time — never `?s`", () => {
		const h = harness({ W: 80, H: 24 });
		h.body.enter();
		turn(h.body, 1);
		h.tick();
		const all = h.screen.allLines().join("\n");
		expect(all).toContain("file1.ts");
		expect(all).not.toContain("?s");
	});

	it("ctrl+r reads the folded turns: the fold is an entry, and opening it shows what was asked and answered", () => {
		const h = harness({ W: 80, H: 30 });
		h.body.enter();
		h.body.fold("1 earlier turn · ctrl+r to read", () => turn(h.body, 1));
		turn(h.body, 2);
		h.tick();
		h.body.viewerToggleMode(); // the cursor opens on the NEWEST entry — the fold is the oldest
		h.tick();
		h.body.viewerKey("up");
		h.tick();
		h.body.viewerKey("toggle");
		h.tick();
		const shown = h.screen.rows.map((r) => r.join("")).join("\n");
		expect(shown).toContain("1 earlier turn · ctrl+r to read");
		expect(shown).toContain("ask number 1");
		expect(shown).toContain("reply number 1");
		expect(shown).toContain("file1.ts");
	});

	it("a checkpoint's entry shows its summary before the turns it covers", () => {
		const h = harness({ W: 80, H: 30 });
		h.body.enter();
		h.body.fold("checkpoint · summarizes 1 earlier turn · ctrl+r to read", () => turn(h.body, 1), "we set up the repo and wrote the parser");
		turn(h.body, 2);
		h.tick();
		h.body.viewerToggleMode(); // the cursor opens on the NEWEST entry — the fold is the oldest
		h.tick();
		h.body.viewerKey("up");
		h.tick();
		h.body.viewerKey("toggle");
		h.tick();
		const shown = h.screen.rows.map((r) => r.join("")).join("\n");
		const summary = shown.indexOf("we set up the repo");
		expect(summary).toBeGreaterThan(-1);
		expect(shown.indexOf("ask number 1")).toBeGreaterThan(summary);
	});

	it("route B: a resize reprints the fold as its ONE row — a 1,500-turn history costs what a 1-turn one does", () => {
		const reprintBytes = (turns: number): { bytes: number; all: string } => {
			const h = harness({ W: 80, H: 24 });
			h.body.enter();
			h.body.fold(`${turns} earlier turns · ctrl+r to read`, () => {
				for (let i = 0; i < turns; i += 1) turn(h.body, i);
			});
			turn(h.body, 9999);
			h.tick();
			h.writes.length = 0;
			h.setSize(60, 24);
			h.body.onResize();
			h.tick();
			const bytes = h.writes.join("");
			expect(bytes, "the resize did not reprint").toContain("\x1b[2J\x1b[H\x1b[3J");
			return { bytes: bytes.length, all: h.screen.allLines().join("\n") };
		};
		const one = reprintBytes(1);
		const many = reprintBytes(1500);
		expect(many.all.match(/1500 earlier turns · ctrl\+r to read/g)).toHaveLength(1);
		expect(many.all).not.toContain("ask number 0");
		expect(many.all).toContain("ask number 9999");
		// the only difference is the digits in the label
		expect(Math.abs(many.bytes - one.bytes)).toBeLessThan(16);
	});
});
