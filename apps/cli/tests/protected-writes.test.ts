/**
 * 0.40.0 — writes into `.git/**` and `.kiso/**` always ask (the lead's
 * ruling on the read-only shell plan). Both directories hold configuration
 * that RUNS; accept-edits' allow and a saved allow must not carry a write
 * into either.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { KisoExtension } from "@vincemakes/kiso-runtime";
import { modeExtensions, setMode } from "../src/mode.js";
import { guardSavedAllow, isProtectedWrite } from "../src/protected-writes.js";

let root = "";

beforeAll(() => {
	root = join(realpathSync(mkdtempSync(join(tmpdir(), "kiso-pw-"))), "ws");
	mkdirSync(join(root, ".git", "hooks"), { recursive: true });
	mkdirSync(join(root, ".kiso"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	symlinkSync(join(root, ".git"), join(root, "innocent-dir"));
});

afterEach(() => {
	setMode("default");
});

const write = (path: string, name = "write_file") => ({ name, input: { path, content: "x" } });

describe("which writes are protected", () => {
	it("a .git or .kiso component, as written or once symlinks are followed", () => {
		for (const p of [".git/config", "./.git/hooks/pre-commit", "vendor/lib/.git/config", ".kiso/config.json", ".kiso/extensions/x.mjs", "innocent-dir/config"]) {
			expect(isProtectedWrite(write(p), root), p).toBe(true);
		}
		expect(isProtectedWrite(write(".git/config", "edit_file"), root)).toBe(true);
	});

	it("names that only look alike are not, and other tools are not writes", () => {
		for (const p of ["src/a.ts", ".github/workflows/ci.yml", ".gitignore", ".gitattributes", ".kisorc", "docs/.git-notes.md"]) {
			expect(isProtectedWrite(write(p), root), p).toBe(false);
		}
		expect(isProtectedWrite({ name: "read_file", input: { path: ".git/config" } }, root)).toBe(false);
	});
});

describe("accept-edits asks for them; every other write it still allows", () => {
	const decide = async (path: string) => {
		setMode("accept-edits");
		const tier = modeExtensions(() => root).find((e) => e.name === "mode:accept-edits")!;
		return tier.approvals![0]!.decide(write(path), {} as never);
	};

	it("asks for .git/config and .kiso/config.json, allows src/a.ts", async () => {
		expect(await decide(".git/config")).toEqual({ action: "ask" });
		expect(await decide(".kiso/config.json")).toEqual({ action: "ask" });
		expect(await decide("src/a.ts")).toEqual({ action: "allow" });
	});
});

describe("a saved allow never carries one", () => {
	it("abstains for a protected write, decides the rest as before, keeps its live handle", async () => {
		const rules = new Set(["write_file"]);
		const saved = {
			name: "dont-ask-again",
			rules,
			approvals: [{ decide: (call: { name: string }) => (rules.has(call.name) ? { action: "allow" as const } : { action: "abstain" as const }) }],
		} as unknown as KisoExtension & { rules: Set<string> };
		const guarded = guardSavedAllow(saved, (call) => isProtectedWrite(call, root)) as KisoExtension & { rules: Set<string> };
		expect(await guarded.approvals![0]!.decide(write(".git/config"), {} as never)).toEqual({ action: "abstain" });
		expect(await guarded.approvals![0]!.decide(write("src/a.ts"), {} as never)).toEqual({ action: "allow" });
		expect(guarded.rules).toBe(rules);
		const other = { name: "safe-test", approvals: [] } as KisoExtension;
		expect(guardSavedAllow(other, () => true)).toBe(other);
	});
});
