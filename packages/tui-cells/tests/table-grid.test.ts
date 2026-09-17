/**
 * The table draws a FULL GRID — declared reversal, tables only.
 *
 * R2 removed the rails at the nineteen-screen review ("a table is bounded
 * by the blank lines above and below it, exactly as every other block")
 * and MD-1.3 put ONE rule under the header. Both are superseded HERE, for
 * tables only; every other R2 hairline rule stands. This is a decision
 * changed, not a defect fixed, which is why it ships in a round and not a
 * patch.
 *
 * THE MEASURE IS THE CHANGE. `gridWidth` moves from `sum + 2n + 2` (two
 * columns of inset plus each column and its two-space gutter) to
 * `sum + 3n + 1` (rails n+1, one space of padding each side). Everything
 * else — the greedy shrink, the CELL_FLOOR of 8, the record fallback when
 * every column is at its floor — already existed and is untouched. The
 * grid therefore costs exactly n−1 columns against today: 2 for a
 * three-column table, 6 for a seven-column one.
 *
 * THE GATE IS MEASURED, NOT LOOKED AT. Every emitted line's visible width
 * must equal the border's, at every ladder width, for ASCII and CJK
 * fixtures both. That is not ceremony: producing the frames, four of the
 * seven ladder widths emitted rows ONE column wider than their own
 * border, and the frames looked correct — the borders were right and the
 * rows were not. The cause was a wrap point's trailing space, and it was
 * in the ASCII row, not the CJK row. So both fixtures stay.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visibleWidth } from "../src/components.js";
import { renderMarkdown } from "../src/md.js";

beforeEach(() => {
	Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
});
afterEach(() => {
	delete (process.stdout as { isTTY?: boolean }).isTTY;
});

const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const ASCII = [
	"| tool | what it is for | note |",
	"|---|---|---|",
	"| read_file | read a file or a range | 200 lines by default |",
	"| search_text | search the corpus, honouring .gitignore and skipping the credential set | wrapped row |",
].join("\n");

// Escaped, not literal: the tracked tree is CJK-free (CLAUDE.md), and the
// existing table cases in tui2-md-table.test.ts escape for the same reason.
// The cells are wide-character headers and one long wide sentence,
// chosen so a width error shows up against the rails. (And yes: the first
// draft of THIS comment named them in the characters themselves and the
// gate caught that too.)
const CJK = [
	"| \u5de5\u5177 | \u7528\u9014 | \u5907\u6ce8 |",
	"|---|---|---|",
	"| \u8bfb\u6587\u4ef6 | \u8bfb\u4e00\u4e2a\u6587\u4ef6\u6216\u4e00\u6bb5\u8303\u56f4 | \u9ed8\u8ba4 200 \u884c |",
	"| \u641c\u7d22 | \u5217\u51fa\u4e00\u4e2a\u76ee\u5f55\u7684\u6761\u76ee,\u7ed9\u4e86 glob \u5c31\u9012\u5f52\u641c\u7d22\u6574\u68f5\u6811 | \u4e2d\u65e5\u97e9\u884c |",
].join("\n");

const LADDER = [88, 80, 72, 64, 56, 48];
const grid = (src: string, w: number): string[] => renderMarkdown(src, w).map(plain).filter((l) => l.trim() !== "");

describe("the table grid", () => {
	it("draws rails and a full border", () => {
		const out = grid(ASCII, 88);
		expect(out[0]).toMatch(/^┌─+(?:┬─+)+┐$/);
		expect(out.at(-1)).toMatch(/^└─+(?:┴─+)+┘$/);
		expect(out.some((l) => /^├─+(?:┼─+)+┤$/.test(l))).toBe(true);
		expect(out.filter((l) => l.startsWith("│")).length).toBeGreaterThan(0);
	});

	it("puts a rule between EVERY row, not only under the header", () => {
		const out = grid(ASCII, 88);
		const junctions = out.filter((l) => /^├/.test(l)).length;
		// header/body, then body/body: one fewer than the number of rows
		expect(junctions).toBe(2);
	});

	// THE GATE. Four of seven widths failed this while the frames looked right.
	for (const src of [["ASCII", ASCII], ["CJK", CJK]] as const) {
		it(`every line matches the border's width at every ladder width — ${src[0]}`, () => {
			for (const W of LADDER) {
				const out = grid(src[1], W);
				const widths = [...new Set(out.map(visibleWidth))];
				expect(widths, `${src[0]} at ${W}: widths ${widths.join("/")}`).toHaveLength(1);
				expect(widths[0], `${src[0]} at ${W} overflows`).toBeLessThanOrEqual(W);
			}
		});
	}

	it("a cell still wraps INSIDE its column, and the continuation stays inside the rails", () => {
		const out = grid(ASCII, 56);
		const body = out.filter((l) => l.startsWith("│"));
		expect(body.length).toBeGreaterThan(4); // the long cell wrapped
		for (const l of body) expect(l).toMatch(/^│.*│$/);
	});

	it("falls back to records only when every column is at its floor — the existing rule, unchanged", () => {
		// three columns at CELL_FLOOR 8 need 8*3 + 3*3 + 1 = 34
		expect(grid(ASCII, 34).some((l) => l.startsWith("┌"))).toBe(true);
		expect(grid(ASCII, 33).some((l) => l.startsWith("┌"))).toBe(false);
	});
});
