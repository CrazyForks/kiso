/**
 * ACI-2 — a search that matches more than once is a question, not an edit.
 *
 * `text.indexOf(search)` took the first occurrence and the description
 * ADVERTISED that ("first exact occurrence"), so a caller who meant the
 * second one got a silent wrong edit: the tool reported success, the
 * revision advanced, and nothing anywhere said which of the N places was
 * chosen. That is the worst failure shape a mutation tool has — a wrong
 * write that looks like a right one.
 *
 * The refusal has to carry enough to fix the call without re-reading the
 * file, so it names the COUNT and WHERE. Two things in here are the ones
 * an implementation gets wrong:
 *
 *  - the line numbers must be the file's real lines. A refusal that sends
 *    the caller to the wrong line is worse than one that says nothing.
 *  - overlapping occurrences count. "aa" in "aaa" can resolve at offset 0
 *    or offset 1 and the results differ, so it is ambiguous; a scan that
 *    steps past each match by its own length reports 1 and edits blind.
 *
 * And the refusal must not have written: a tool that refuses AFTER
 * mutating has kept neither promise.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editFileTool } from "../src/index.js";

const rev = (s: string): string => `rev:${createHash("sha256").update(Buffer.from(s)).digest("hex").slice(0, 16)}`;

function ws(text: string): { root: string; edit: ReturnType<typeof editFileTool>; rev: string; read: () => string } {
	const root = mkdtempSync(join(tmpdir(), "kiso-aci2-"));
	writeFileSync(join(root, "f.js"), text);
	return { root, edit: editFileTool({ workspaceRoot: root }), rev: rev(text), read: () => readFileSync(join(root, "f.js"), "utf8") };
}

// Lines 1 and 2 both call compute(); line 3 does not.
const TWICE = ["const a = compute();", "const b = compute();", "return a + b;", ""].join("\n");

describe("ACI-2 — edit_file refuses a search it cannot resolve", () => {
	it("refuses when the search matches twice, and does not write", async () => {
		const w = ws(TWICE);
		const r = await w.edit.execute({ path: "f.js", search: "compute()", replace: "derive()", expectedRevision: w.rev }, {} as never);
		expect(r.isError).toBe(true);
		expect(r.isError && r.errorKind).toBe("precondition");
		expect(w.read()).toBe(TWICE); // the byte-level promise: nothing ran
	});

	it("names the count and the REAL line numbers, so the call can be fixed without a re-read", async () => {
		const w = ws(TWICE);
		const r = await w.edit.execute({ path: "f.js", search: "compute()", replace: "derive()", expectedRevision: w.rev }, {} as never);
		expect(r.content).toContain("matches 2 places in f.js");
		expect(r.content).toContain("lines 1, 2");
		// the caller is told what to DO, not merely what went wrong
		expect(r.content).toContain("unique");
	});

	it("counts OVERLAPPING occurrences — 'aa' in 'aaa' is ambiguous", async () => {
		const w = ws("aaa\n");
		const r = await w.edit.execute({ path: "f.js", search: "aa", replace: "b", expectedRevision: w.rev }, {} as never);
		expect(r.isError).toBe(true);
		expect(r.content).toContain("matches 2 places");
		expect(w.read()).toBe("aaa\n");
	});

	it("lists each line ONCE even when a line holds several matches", async () => {
		const w = ws("x x x\ny\n"); // three matches, all on line 1
		const r = await w.edit.execute({ path: "f.js", search: "x", replace: "z", expectedRevision: w.rev }, {} as never);
		expect(r.content).toContain("matches 3 places");
		expect(r.content).toContain("line 1");
		expect(r.content).not.toContain("1, 1");
		// the tail counts LINES still to name, never matches: "and 2 more"
		// here would send the caller looking for two lines that do not exist
		expect(r.content).not.toContain("more");
	});

	it("caps the line list instead of printing hundreds of numbers", async () => {
		const many = `${Array.from({ length: 40 }, (_, i) => `row${i} hit`).join("\n")}\n`;
		const w = ws(many);
		const r = await w.edit.execute({ path: "f.js", search: "hit", replace: "miss", expectedRevision: w.rev }, {} as never);
		expect(r.content).toContain("matches 40 places");
		expect(r.content).toContain("more");
		expect(r.content.length).toBeLessThan(220);
	});

	it("names the HUNK in the batch form, the way a missing pattern does", async () => {
		const w = ws(TWICE);
		const r = await w.edit.execute(
			{ path: "f.js", edits: [{ search: "return a + b;", replace: "return a * b;" }, { search: "compute()", replace: "derive()" }], expectedRevision: w.rev },
			{} as never,
		);
		expect(r.isError).toBe(true);
		expect(r.content).toContain("hunk 2");
		expect(w.read()).toBe(TWICE); // the atomic promise: hunk 1 did not land either
	});

	it("a UNIQUE search still edits — the refusal must not cost the normal path", async () => {
		const w = ws(TWICE);
		const r = await w.edit.execute({ path: "f.js", search: "return a + b;", replace: "return a * b;", expectedRevision: w.rev }, {} as never);
		expect(r.isError ?? false).toBe(false);
		expect(w.read()).toContain("return a * b;");
	});

	// Turning one indexOf into a LOOP needs the termination condition derived
	// again, not assumed: indexOf("", n) clamps n to the string length, so once
	// the cursor reaches the end it returns the same offset forever. The old
	// single call could not hang; this loop can. A tool that never returns is
	// worse than every bug ACI-2 exists to prevent.
	it("terminates on an EMPTY search instead of spinning forever", { timeout: 3000 }, async () => {
		const w = ws("abc\n");
		const r = await w.edit.execute({ path: "f.js", search: "", replace: "X", expectedRevision: w.rev }, {} as never);
		expect(r.isError).toBe(true); // matches everywhere — the maximal non-unique case
		expect(w.read()).toBe("abc\n");
	});

	it("the description no longer promises a first-occurrence rule it does not follow", () => {
		const t = editFileTool({ workspaceRoot: "/tmp" });
		expect(t.description).not.toContain("first exact occurrence");
	});
});
