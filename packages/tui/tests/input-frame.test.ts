/**
 * 0.40.0 dogfood item 6 (b) — a key-originated frame paints on the next
 * tick; every other source keeps the trailing frame window exactly.
 *
 * Measured before (real PTY, KISO_TRACE_BYTES, 20+20 keys): every key's
 * first paint landed one full frame window after the key — 18 ms, and
 * 42 ms under TERM_PROGRAM=Apple_Terminal, ASCII and CJK alike. On
 * Terminal.app an IME commit erases the terminal's marked text at once,
 * so the committed characters blinked out for that window. The
 * reference implementation's input path requests an immediate render
 * (next tick, cancelling any throttled timer) and throttles only the
 * other sources; this is that shape.
 *
 * Pinned here:
 *   - a streaming-only run's frame count is unchanged (the counts were
 *     read on the code before this change and are pinned as numbers);
 *   - a non-key redraw still waits its window (16 / 40 ms);
 *   - a key redraw paints on the next tick, takes the pending trailing
 *     frame with it (no second frame for the same state), and one chunk
 *     of keys is one frame;
 *   - a key whose consequence is run state (the body mutated between the
 *     key and the tick: a verdict, a submit) keeps the run's window —
 *     tui-v7-expand caught the immediate path painting an approved
 *     write's transient live card for one frame.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Body } from "../src/index.js";
import type { InputState } from "../src/compositor.js";

const provider = (): InputState => ({ line: "", cursor: 0 });

function body(termProgram: string): { b: Body; frames: () => number } {
	const writes: string[] = [];
	const b = new Body({ active: () => true, height: () => 24, width: () => 80, editCol: () => 1, write: (s) => writes.push(s), termProgram });
	b.bindInput(provider, "› ");
	b.enter();
	vi.advanceTimersByTime(100);
	const base = writes.length;
	return { b, frames: () => writes.slice(base).filter((w) => w.includes("\x1b[?25l")).length };
}

afterEach(() => {
	vi.useRealTimers();
});

/** A stream: one delta every 5 ms for 400 ms, then settle. */
function stream(b: Body): void {
	for (let i = 0; i < 80; i += 1) {
		b.textAppend(`delta ${i} \u4e2d\u6587 `);
		vi.advanceTimersByTime(5);
	}
	vi.advanceTimersByTime(200);
}

describe("item 6 (b) — the input frame", () => {
	it("a streaming-only run's frame count is unchanged (pinned from the code before)", () => {
		vi.useFakeTimers();
		const iterm = body("iTerm.app");
		stream(iterm.b);
		const apple = body("Apple_Terminal");
		stream(apple.b);
		expect({ iterm: iterm.frames(), apple: apple.frames() }).toEqual(STREAM_FRAMES);
	});

	it("a non-key redraw still waits its window: nothing at 15 ms / 39 ms, one frame after", () => {
		vi.useFakeTimers();
		for (const [tp, ms] of [["iTerm.app", 16], ["Apple_Terminal", 40]] as const) {
			const { b, frames } = body(tp);
			b.redraw();
			vi.advanceTimersByTime(ms - 1);
			expect(frames(), `${tp}: painted inside the window`).toBe(0);
			vi.advanceTimersByTime(1);
			expect(frames(), tp).toBe(1);
		}
	});

	it("a key whose consequence is run state keeps the run's window: no paint on the tick, one at the window", () => {
		vi.useFakeTimers();
		for (const [tp, ms, demote] of [
			["iTerm.app", 16, "mark"],
			["Apple_Terminal", 40, "mark"],
			["iTerm.app", 16, "redraw"],
			["Apple_Terminal", 40, "redraw"],
		] as const) {
			const { b, frames } = body(tp);
			b.redraw(true); // the verdict key...
			// ...then the run's own mutation, or the editor's non-key render
			// after a verdict/submit, before the tick
			if (demote === "mark") b.textAppend("the run moved");
			else b.redraw(false);
			vi.advanceTimersByTime(0);
			expect(frames(), `${tp}: a frame carrying run state painted off the run's window`).toBe(0);
			vi.advanceTimersByTime(ms);
			expect(frames(), tp).toBe(1);
		}
	});

	it("a key redraw paints on the next tick and takes the pending trailing frame with it", () => {
		vi.useFakeTimers();
		for (const tp of ["iTerm.app", "Apple_Terminal"]) {
			const { b, frames } = body(tp);
			b.textAppend("streaming"); // arms the trailing window
			b.redraw(true);
			b.redraw(true); // one chunk of keys: several redraws, one frame
			vi.advanceTimersByTime(0);
			expect(frames(), `${tp}: the key did not paint on the next tick`).toBe(1);
			vi.advanceTimersByTime(100);
			expect(frames(), `${tp}: the cancelled trailing frame painted anyway`).toBe(1);
		}
	});
});

const STREAM_FRAMES = { iterm: 20, apple: 10 }; // read on the code before this change
