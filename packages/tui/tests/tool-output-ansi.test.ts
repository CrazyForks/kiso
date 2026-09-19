/**
 * 0.40.0 (the owner's dogfood) — a coloured tool output reaches the card
 * without its styling, and without the remnants of it.
 *
 * escapeTerminal drops the ESC byte alone, so a test run's colours reached
 * the shell card as `[31m─── [1m[41m Failed Tests 2 [49m`. The output body
 * now drops each whole sequence first. A NAME keeps the old escape: there
 * the `[31m` remnant is what shows an injection (strings.test.ts pins it).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeTerminal, stripAnsi } from "@vincemakes/kiso-tui-cells/render";
import { Body } from "../src/compositor.js";

const E = "\x1b";
/** What a coloured vitest run prints, as the owner's card received it. */
const VITEST = [
	`${E}[31m────────${E}[39m${E}[1m${E}[41m Failed Tests 2 ${E}[49m${E}[22m${E}[31m────────${E}[39m`,
	`${E}[2m      Tests ${E}[22m ${E}[1m${E}[31m2 failed${E}[39m${E}[22m${E}[2m | ${E}[22m${E}[1m${E}[32m13 passed${E}[39m${E}[22m${E}[90m (15)${E}[39m`,
].join("\n");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("tool output without its terminal styling", () => {
	it("every kind of sequence goes whole: colours, titles, links, charset, 8-bit CSI", () => {
		expect(stripAnsi(VITEST)).toBe(["──────── Failed Tests 2 ────────", "      Tests  2 failed | 13 passed (15)"].join("\n"));
		expect(stripAnsi(`a${E}]0;title\x07b${E}]8;;https://x${E}\\link${E}]8;;${E}\\c`)).toBe("ablinkc");
		expect(stripAnsi(`${E}(B${E}[mdone \x9b31mred`)).toBe("done red");
		expect(stripAnsi("plain [31m text")).toBe("plain [31m text"); // no ESC, nothing to strip
	});

	it("the shell card shows the words and none of the remnants", () => {
		const writes: string[] = [];
		const body = new Body({ active: () => true, height: () => 24, width: () => 100, editCol: () => 1, write: (s) => writes.push(s) });
		body.enter();
		body.toolStart("shell", "c1", { command: "npx vitest run" });
		body.toolRunning("c1");
		body.toolResult("c1", { content: VITEST, isError: false });
		vi.advanceTimersByTime(16);
		const frame = writes.join("");
		expect(frame).toContain("Failed Tests 2");
		expect(frame).toContain("2 failed | 13 passed (15)");
		for (const remnant of ["[31m", "[41m", "[39m", "[22m", "[90m"]) expect(frame).not.toContain(remnant);
	});

	it("a NAME keeps the visible remnant — stripping it would let an injected name pass as another", () => {
		expect(escapeTerminal(`sh${E}[31mell`)).toBe("sh[31mell");
	});
});
