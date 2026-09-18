/**
 * 0.40.0 — a note in a diff is not a line of the file.
 *
 * Three notes rode the diff's CONTEXT kind: the renderer's own cut
 * ("… N lines (/last for full)"), "pattern not found in <path>" and
 * "pattern matches more than one place in <path>". Drawn through the
 * context path they sat indented under the gutter exactly where the
 * file's unchanged lines sit — on the approval panel, at the moment a
 * person reads what an edit will do. They get their own kind, and the
 * renderer draws it in the MARKER column (where `-` and `+` sit), which
 * no line of the file ever occupies.
 */
import { describe, expect, it } from "vitest";
import { editFileDiff, truncateDiff } from "../src/diff.js";
import { diffBody } from "../src/components.js";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("0.40.0 — the note row kind", () => {
	it("the three notes carry kind note; real lines keep theirs", () => {
		expect(editFileDiff("a\nb", "zzz", "y", "f.ts").lines).toEqual([{ kind: "note", text: "pattern not found in f.ts" }]);
		expect(editFileDiff("D\nD\n", "D", "E", "f.ts").lines[0]!.kind).toBe("note");
		const long = Array.from({ length: 60 }, (_, i) => ({ kind: " " as const, text: `line ${i}` }));
		const cut = truncateDiff(long);
		expect(cut[18]).toEqual({ kind: "note", text: "… 24 lines (/last for full)" });
		expect(cut.filter((l) => l.kind === "note")).toHaveLength(1);
	});

	it("a note is drawn in the marker column; a context line is indented under it", () => {
		const rows = diffBody(
			[
				{ kind: " ", text: "unchanged" },
				{ kind: "note", text: "pattern not found in f.ts" },
			],
			80,
		).map(strip);
		expect(rows).toEqual(["│   unchanged", "│ pattern not found in f.ts"]);
	});

	it("a long note folds under its own column, every row inside the width", () => {
		const text = `pattern not found in ${"deep/".repeat(20)}file.ts`;
		const rows = diffBody([{ kind: "note", text }], 40).map(strip);
		expect(rows.length).toBeGreaterThan(1);
		for (const r of rows) expect([...r].length).toBeLessThanOrEqual(40);
		expect(rows.join("")).toContain("file.ts");
	});
});
