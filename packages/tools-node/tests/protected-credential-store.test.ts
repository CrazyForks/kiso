/**
 * kiso never serves its own credential store to a model (the 2026-09-14
 * incident; kiso-doc plan-protected-credential-store-2026-09-19).
 *
 * The incident's exact shape — the workspace IS the home directory and the
 * model names `.kiso/auth.json` — and every other way to name the same file:
 * a symlink, a `..` through a symlinked directory, a case variant, a hard
 * link. Each must be refused (or never reach the store), and the store's
 * secret must appear in no tool output. The write tools must not touch it,
 * and a search must never return a line from it.
 *
 * A TEMP home, never the real one.
 */

import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "@vincemakes/kiso-core";
import { editFileTool, readFileTool, searchTextTool, writeFileTool, type WorkspaceToolsOptions } from "../src/index.js";

const CTX = { signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} } } as unknown as ToolContext;
const CANARY = "sk-canary-protected-store-0000";
const STORE_TEXT = `${JSON.stringify({ version: 1, credentials: { deepseek: { type: "api-key", key: CANARY } } }, null, 2)}\n`;

let HOME = "";
let STORE = "";
let opts: WorkspaceToolsOptions;

beforeEach(() => {
	HOME = realpathSync(mkdtempSync(join(tmpdir(), "kiso-protected-")));
	mkdirSync(join(HOME, ".kiso"));
	STORE = join(HOME, ".kiso", "auth.json");
	writeFileSync(STORE, STORE_TEXT, { mode: 0o600 });
	writeFileSync(join(HOME, "notes.md"), "ordinary notes\n");
	opts = { workspaceRoot: HOME, excludeRoots: [join(HOME, ".kiso")], protectedFiles: [STORE] };
});

type R = { content: string; isError: boolean; errorKind?: string };
const read = async (path: string): Promise<R> => (await readFileTool(opts).execute({ path }, CTX)) as R;
const refused = (r: R): void => {
	expect(r.isError).toBe(true);
	expect(r.errorKind).toBe("precondition");
	expect(r.content).toContain("kiso never serves its own credential store to a model");
	expect(r.content).not.toContain(CANARY);
};

describe("read_file never serves the credential store", () => {
	it("the incident: workspace = home, `read_file .kiso/auth.json`", async () => {
		refused(await read(".kiso/auth.json"));
	});

	it("an ordinary file beside it is still served", async () => {
		const r = await read("notes.md");
		expect(r.isError).toBe(false);
		expect(r.content).toContain("ordinary notes");
	});

	it("a symlink to the store", async () => {
		symlinkSync(STORE, join(HOME, "creds.json"));
		refused(await read("creds.json"));
	});

	it("a directory symlink, and a `..` through it, never reach the store's bytes", async () => {
		mkdirSync(join(HOME, "sub"));
		symlinkSync(join(HOME, ".kiso"), join(HOME, "sub", "alias"));
		refused(await read("sub/alias/auth.json"));
		const r = await read("sub/alias/../.kiso/auth.json");
		expect(r.content).not.toContain(CANARY);
	});

	it("a case variant, on a disk that folds case", async () => {
		if (!existsSync(join(HOME, ".KISO", "AUTH.JSON"))) return; // a case-sensitive disk: no variant exists
		refused(await read(".KISO/AUTH.JSON"));
	});

	it("a hard link under another name", async () => {
		linkSync(STORE, join(HOME, "innocent.txt"));
		refused(await read("innocent.txt"));
	});

	it("the writer's temp file and lock share the protection", async () => {
		writeFileSync(`${STORE}.tmp-4242`, STORE_TEXT);
		refused(await read(".kiso/auth.json.tmp-4242"));
	});
});

describe("the write tools never touch it", () => {
	it("edit_file refuses, and the store is unchanged", async () => {
		const r = (await editFileTool(opts).execute({ path: ".kiso/auth.json", search: CANARY, replace: "x" }, CTX)) as R;
		refused(r);
		expect(readFileSync(STORE, "utf8")).toBe(STORE_TEXT);
	});

	it("write_file refuses, and the store is unchanged", async () => {
		const r = (await writeFileTool(opts).execute({ path: ".kiso/auth.json", content: "{}\n" }, CTX)) as R;
		refused(r);
		expect(readFileSync(STORE, "utf8")).toBe(STORE_TEXT);
	});
});

describe("a search never returns a line from it", () => {
	it("searching its directory, or the file itself, finds nothing in it", async () => {
		for (const path of [".kiso", ".kiso/auth.json", "."]) {
			const r = (await searchTextTool(opts).execute({ pattern: "canary-protected", path }, CTX)) as R;
			expect(r.content, `search under ${path}`).not.toContain(CANARY);
		}
	});

	it("a search still finds ordinary files", async () => {
		const r = (await searchTextTool(opts).execute({ pattern: "ordinary notes" }, CTX)) as R;
		expect(r.content).toContain("notes.md");
	});
});
