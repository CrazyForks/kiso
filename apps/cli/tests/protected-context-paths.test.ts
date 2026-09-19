/**
 * kiso never serves its own credential store to a model — the paths that
 * are not tools. The audit for the credential-store PR found two that put
 * a protected file's bytes in front of a model with no tool call:
 *
 *  - the project instructions: `<cwd>/AGENTS.md` (or CLAUDE.md) is read
 *    into the SYSTEM PROMPT at every start. A cloned repository whose
 *    AGENTS.md is a symlink to the store served it on every request —
 *    no model action, no trust prompt;
 *  - the image scan of a turn: any path in the text that names a readable
 *    image is attached. A user's own protected file may be an image (a
 *    scan of a passport), and a path in a turn can come from a model's
 *    delegate task or a command's output.
 *
 * The real request, captured on the wire, is in
 * protected-credential-store-e2e.test.ts. A TEMP home, never the real one.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { attachImages } from "../src/attachments.js";
import { readProjectInstructions } from "../src/index.js";

const CANARY = "sk-canary-context-0000";
// the smallest PNG the sniff accepts: the signature and a little more
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("0000000d49484452", "hex")]);

let H = "";
let STORE = "";
let REPO = "";

beforeEach(() => {
	H = realpathSync(mkdtempSync(join(tmpdir(), "kiso-context-paths-")));
	mkdirSync(join(H, ".kiso"));
	STORE = join(H, ".kiso", "auth.json");
	writeFileSync(STORE, `${JSON.stringify({ version: 1, credentials: { deepseek: { type: "api-key", key: CANARY } } })}\n`, { mode: 0o600 });
	REPO = join(H, "repo");
	mkdirSync(REPO);
});

describe("the project instructions never read a protected file", () => {
	it("an AGENTS.md that is a symlink to the store is skipped as though absent", () => {
		symlinkSync(STORE, join(REPO, "AGENTS.md"));
		expect(readProjectInstructions(REPO, [STORE])).toBe("");
	});

	it("and the next instruction file is read in its place", () => {
		symlinkSync(STORE, join(REPO, "AGENTS.md"));
		writeFileSync(join(REPO, "CLAUDE.md"), "use tabs\n");
		const text = readProjectInstructions(REPO, [STORE]);
		expect(text).not.toContain(CANARY);
		expect(text).toContain("Project instructions (CLAUDE.md)");
		expect(text).toContain("use tabs");
	});

	it("an ordinary AGENTS.md is read as before", () => {
		writeFileSync(join(REPO, "AGENTS.md"), "run npm test\n");
		expect(readProjectInstructions(REPO, [STORE])).toContain("run npm test");
	});
});

describe("a turn never attaches a protected image", () => {
	it("named by its path, or through a symlink under another name", () => {
		const passport = join(H, "passport.png");
		writeFileSync(passport, PNG);
		symlinkSync(passport, join(REPO, "shot.png"));
		for (const line of [`what does ${passport} say`, `look at ${join(REPO, "shot.png")}`]) {
			expect(attachImages(line, undefined, [STORE, passport]), line).toBe(line);
		}
	});

	it("an ordinary image beside it is still attached", () => {
		const shot = join(H, "screenshot.png");
		writeFileSync(shot, PNG);
		const out = attachImages(`what is wrong here ${shot}`, undefined, [STORE]);
		expect(Array.isArray(out)).toBe(true);
		expect((out as { type: string }[]).some((b) => b.type === "image")).toBe(true);
	});
});
