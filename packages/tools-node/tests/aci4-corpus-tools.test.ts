/**
 * The corpus, through the two tools that share it.
 *
 * The RED proof for this change is the WIDENING: `.github/` becomes
 * searchable where a `.gitignore` declares the user's intent. The `.env`
 * assertions beside it were green before the change too — every dot entry
 * was skipped — so they are REGRESSION GUARDS whose job is to stay green
 * while the widening goes red, and calling them a red proof would be the
 * red-in-both-positions mistake pointing the other way.
 *
 * The search worker loads from `dist/search-worker.js`, so a src edit
 * changes nothing here until a rebuild. That has cost this programme a
 * round before: a "red" proof that was red in both positions because
 * neither state had been built.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirTool, searchTextTool } from "../src/index.js";

const CTX = { signal: new AbortController().signal } as never;

function ws(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "kiso-aci4-"));
	for (const [rel, body] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, body);
	}
	return root;
}

describe("search_text over the declared corpus", () => {
	it("FINDS a committed dotfile — the widening, and the red proof of this change", async () => {
		const root = ws({ ".gitignore": "dist\n", ".github/workflows/ci.yml": "run: SENTINEL_A\n", "src/a.ts": "x" });
		const r = await searchTextTool({ workspaceRoot: root }).execute({ pattern: "SENTINEL_A", path: "." }, CTX);
		expect(r.isError).toBe(false);
		expect(r.content).toContain(".github/workflows/ci.yml");
	});

	it("still does NOT find .env, gitignored or not — the regression guard", async () => {
		const root = ws({ ".gitignore": "dist\n", ".env": "KEY=SENTINEL_B\n", ".env.local": "KEY=SENTINEL_B\n", "src/a.ts": "x" });
		const r = await searchTextTool({ workspaceRoot: root }).execute({ pattern: "SENTINEL_B", path: "." }, CTX);
		expect(r.content).not.toContain(".env");
	});

	it("DOES find the three templates — they exist to be read", async () => {
		const root = ws({ ".gitignore": "dist\n", ".env.example": "KEY=SENTINEL_C\n" });
		const r = await searchTextTool({ workspaceRoot: root }).execute({ pattern: "SENTINEL_C", path: "." }, CTX);
		expect(r.content).toContain(".env.example");
	});

	it("honours the user's own declaration", async () => {
		const root = ws({ ".gitignore": "build/\n", "build/out.js": "SENTINEL_D\n", "src/a.ts": "SENTINEL_D\n" });
		const r = await searchTextTool({ workspaceRoot: root }).execute({ pattern: "SENTINEL_D", path: "." }, CTX);
		expect(r.content).toContain("src/a.ts");
		expect(r.content).not.toContain("build/out.js");
	});

	it("with NO root .gitignore, keeps the old conservative rule", async () => {
		const root = ws({ ".github/workflows/ci.yml": "SENTINEL_E\n", "src/a.ts": "x" });
		const r = await searchTextTool({ workspaceRoot: root }).execute({ pattern: "SENTINEL_E", path: "." }, CTX);
		expect(r.content).not.toContain(".github");
	});
});

describe("list_dir", () => {
	it("WITHOUT a glob is unchanged — it names entries, it does not search", async () => {
		const root = ws({ ".gitignore": "dist\n", "a.ts": "x", "sub/b.ts": "y" });
		const r = await listDirTool({ workspaceRoot: root }).execute({}, CTX);
		expect(r.content).toContain("file a.ts");
		expect(r.content).toContain("dir  sub/"); // the padding is part of "unchanged"
		expect(r.content).not.toContain("sub/b.ts"); // not recursive
		expect(r.content).toContain(".gitignore"); // a plain listing still shows everything
	});

	it("WITH a glob searches the tree and returns workspace-relative paths", async () => {
		const root = ws({ ".gitignore": "dist\n", "a.ts": "x", "src/deep/b.ts": "y", "src/c.js": "z", "dist/d.ts": "w" });
		const r = await listDirTool({ workspaceRoot: root }).execute({ glob: "**/*.ts" }, CTX);
		expect(r.content).toContain("a.ts");
		expect(r.content).toContain("src/deep/b.ts");
		expect(r.content).not.toContain("src/c.js");
		expect(r.content).not.toContain("dist/d.ts"); // the declaration holds here too
	});

	it("says so when nothing matched, instead of an empty result", async () => {
		const root = ws({ ".gitignore": "x\n", "a.ts": "x" });
		const r = await listDirTool({ workspaceRoot: root }).execute({ glob: "**/*.rs" }, CTX);
		expect(r.isError).toBe(false);
		expect(r.content).toContain("no match");
	});

	it("caps at 200 MATCHES, not 200 files walked past", async () => {
		const files: Record<string, string> = { ".gitignore": "x\n" };
		for (let i = 0; i < 150; i += 1) files[`noise/n${i}.js`] = "x";
		for (let i = 0; i < 250; i += 1) files[`want/w${i}.ts`] = "x";
		const r = await listDirTool({ workspaceRoot: ws(files) }).execute({ glob: "**/*.ts" }, CTX);
		const shown = r.content.split("\n").filter((l) => l.endsWith(".ts")).length;
		expect(shown).toBe(200); // not 50, which is what capping the WALK would give
		expect(r.content).toContain("narrow the pattern");
	});

	it("names a DEPTH cut only when depth actually cut the walk", async () => {
		const shallow = ws({ ".gitignore": "x\n", "a.ts": "x" });
		const r1 = await listDirTool({ workspaceRoot: shallow }).execute({ glob: "**/*.ts" }, CTX);
		expect(r1.content).not.toContain("depth");

		const deep: Record<string, string> = { ".gitignore": "x\n" };
		deep[`${Array.from({ length: 12 }, (_, i) => `d${i}`).join("/")}/deep.ts`] = "x";
		const r2 = await listDirTool({ workspaceRoot: ws(deep) }).execute({ glob: "**/*.ts" }, CTX);
		expect(r2.content).toContain("depth 8");
	});
});
