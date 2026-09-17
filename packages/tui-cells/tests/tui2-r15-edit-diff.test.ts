/**
 * TUI2-R1.5 slice ② — VD-2: the edit approval diff tells the truth.
 *
 * editFileDiff's locator required the search to align to FULL LINES
 * (`oldLines.slice(i, i+n).join("\n") === search`) while the tool it
 * previews is a plain `text.indexOf(search)`. Every mid-line search
 * therefore missed, fell into the "no occurrence → the whole file is the
 * old side" branch, and rendered the entire file as deleted — at the
 * APPROVAL MOMENT, the one surface where a human is deciding whether to
 * let a write happen. The walkthrough's frame s1-05 is that lie: a
 * one-line edit shown as −5 +1.
 *
 * The tool's own semantics are the contract (tools-node edit_file):
 *   i = text.indexOf(search); i === -1 → "pattern not found in <path>"
 *   result = text.slice(0, i) + replace + text.slice(i + search.length)
 *
 * Red on base: the mid-line case reports {added: 1, removed: 5}.
 */

import { describe, expect, it } from "vitest";
import { editFileDiff, writeFileDiff } from "../src/diff.js";

/** The walkthrough's own fixture — src/parser.ts, with "// OLD" INDENTED
 *  inside its line, which is what made the line-aligned locator miss. */
const PARSER = "export function parseExpr(t: Token) {\n  // OLD\n  return t;\n}\n";

describe("TUI2-R1.5 ② — editFileDiff locates the way the tool does (VD-2)", () => {
	it("the walkthrough's MID-LINE search is a one-line ± diff, not a deleted file", () => {
		const r = editFileDiff(PARSER, "// OLD", "if (t == null) throw new Error('null token');");
		expect({ added: r.added, removed: r.removed }).toEqual({ added: 1, removed: 1 });
		const minus = r.lines.filter((l) => l.kind === "-");
		const plus = r.lines.filter((l) => l.kind === "+");
		expect(minus.map((l) => l.text)).toEqual(["  // OLD"]);
		expect(plus.map((l) => l.text)).toEqual(["  if (t == null) throw new Error('null token');"]);
		// the surrounding lines are CONTEXT, and the function signature is
		// not reported as deleted
		expect(r.lines.some((l) => l.kind === "-" && l.text.includes("parseExpr"))).toBe(false);
	});

	it("a search that spans a line boundary mid-line still splices exactly", () => {
		const old = "alpha\nbeta gamma\ndelta\n";
		const r = editFileDiff(old, "gamma\ndel", "GG\nDEL");
		expect({ added: r.added, removed: r.removed }).toEqual({ added: 2, removed: 2 });
		expect(r.lines.filter((l) => l.kind === "-").map((l) => l.text)).toEqual(["beta gamma", "delta"]);
		expect(r.lines.filter((l) => l.kind === "+").map((l) => l.text)).toEqual(["beta GG", "DELta"]);
	});

	it("a FULL-LINE search keeps its old behaviour, byte for byte", () => {
		const old = ["a", "b", "OLD", "c", "d"].join("\n");
		const r = editFileDiff(old, "OLD", "NEW");
		expect(r.lines.map((l) => `${l.kind}${l.text}`)).toEqual([" a", " b", "-OLD", "+NEW", " c", " d"]);
		expect(r.added).toBe(1);
		expect(r.removed).toBe(1);
	});

	it("a search that is NOT THERE is an honest note — never a fabricated diff", () => {
		const r = editFileDiff("one\ntwo", "absent", "x", "src/thing.ts");
		expect(r.notFound).toBe(true);
		expect(r.added).toBe(0);
		expect(r.removed).toBe(0);
		expect(r.lines.map((l) => l.text)).toEqual(["pattern not found in src/thing.ts"]);
		expect(r.lines.every((l) => l.kind === " ")).toBe(true);
	});

	it("the not-found note names the file even when the caller passes none", () => {
		const r = editFileDiff("one\ntwo", "absent", "x");
		expect(r.notFound).toBe(true);
		expect(r.lines[0]!.text).toBe("pattern not found in the file");
	});

	it("the diff is WINDOWED — a 200-line file with a one-line edit shows the region, not the file", () => {
		const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
		const old = `${lines.join("\n")}\n`;
		const r = editFileDiff(old, "line 100", "LINE ONE HUNDRED");
		expect({ added: r.added, removed: r.removed }).toEqual({ added: 1, removed: 1 });
		// 2 context rows each side + the ± pair
		expect(r.lines).toHaveLength(6);
		expect(r.lines.map((l) => `${l.kind}${l.text}`)).toEqual([
			" line 98",
			" line 99",
			"-line 100",
			"+LINE ONE HUNDRED",
			" line 101",
			" line 102",
		]);
	});

	// DECLARED SUPERSESSION (ACI-2). This pinned "the FIRST occurrence is
	// previewed". Since ACI-2 the tool REFUSES an ambiguous search, and this
	// diff is drawn for the APPROVAL PANEL — before the tool runs. Previewing
	// a change at the first of N places therefore showed a human the exact
	// edit ACI-2 exists to prevent, and asked them to approve an edit that
	// would then be refused. Same rule this function already states for a
	// miss: no diff for an edit that will not happen.
	it("an AMBIGUOUS search is reported, not previewed at the first of N places", () => {
		const old = "x\nDUP\ny\nDUP\nz\n";
		const r = editFileDiff(old, "DUP", "ONE", "f.ts");
		expect({ added: r.added, removed: r.removed }).toEqual({ added: 0, removed: 0 });
		expect(r.lines.map((l) => l.text).join("")).toContain("more than one place");
		expect(r.lines.map((l) => l.text).join("")).toContain("f.ts");
		// and nothing is drawn as changed
		expect(r.lines.every((l) => l.kind === " ")).toBe(true);
	});

	it("a UNIQUE search is still previewed normally", () => {
		const old = "x\nONLY\ny\n";
		const r = editFileDiff(old, "ONLY", "TWO");
		expect({ added: r.added, removed: r.removed }).toEqual({ added: 1, removed: 1 });
		expect(r.lines.filter((l) => l.kind === "+").map((l) => l.text)).toEqual(["TWO"]);
	});

	it("an INSERTION (replace contains the search) reports one changed line, not a rewrite", () => {
		const old = "a\nkeep me\nb\n";
		const r = editFileDiff(old, "keep me", "keep me\nand this");
		expect({ added: r.added, removed: r.removed }).toEqual({ added: 1, removed: 0 });
		expect(r.lines.filter((l) => l.kind === "+").map((l) => l.text)).toEqual(["and this"]);
	});
});

describe("ACI-2 coda — every diff result says WHICH of the three it is", () => {
	// `notFound` was set and never read anywhere in the tree, and ACI-2 made
	// it narrower than it looks: it means the search was not found, it has
	// never meant there is no diff, and since ACI-2 those differ. `outcome`
	// is the complete discriminator — set on every result, so the ambiguous
	// case is representable instead of silent.
	it("editFileDiff names all three outcomes", () => {
		expect(editFileDiff("x\nONLY\ny\n", "ONLY", "TWO").outcome).toBe("diff");
		expect(editFileDiff("x\ny\n", "MISSING", "TWO", "f.ts").outcome).toBe("not-found");
		expect(editFileDiff("x\nDUP\ny\nDUP\nz\n", "DUP", "ONE", "f.ts").outcome).toBe("ambiguous");
	});

	it("writeFileDiff is always a diff — a new file and an edited one alike", () => {
		expect(writeFileDiff(null, "a\nb\n").outcome).toBe("diff");
		expect(writeFileDiff("a\n", "a\nb\n").outcome).toBe("diff");
	});

	it("notFound keeps EXACTLY the meaning it always had", () => {
		// the deprecated flag must not quietly acquire the ambiguous case:
		// a consumer reading it today gets the same answer tomorrow
		expect(editFileDiff("x\ny\n", "MISSING", "T", "f.ts").notFound).toBe(true);
		expect(editFileDiff("x\nDUP\ny\nDUP\n", "DUP", "T", "f.ts").notFound).toBeUndefined();
		expect(editFileDiff("x\nONLY\n", "ONLY", "T").notFound).toBeUndefined();
	});

	it("a non-diff outcome carries no counted change", () => {
		for (const r of [editFileDiff("x\ny\n", "MISSING", "T", "f.ts"), editFileDiff("a\nDUP\nDUP\n", "DUP", "T", "f.ts")]) {
			expect({ added: r.added, removed: r.removed }).toEqual({ added: 0, removed: 0 });
			expect(r.outcome).not.toBe("diff");
		}
	});
});
