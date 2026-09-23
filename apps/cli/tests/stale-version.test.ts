import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { installedVersion, resetStaleVersionNotice, staleVersionNotice, versionStatusLine } from "../src/stale-version.js";

/**
 * 0.40.5 — the owner, 2026-09-23: a session started on 0.40.2 kept running
 * 0.40.2 after 0.40.3 was installed, and nothing in it said so.
 */

const pkg = (content: string): string => {
	const p = join(mkdtempSync(join(tmpdir(), "kiso-stale-version-")), "package.json");
	writeFileSync(p, content);
	return p;
};

beforeEach(() => resetStaleVersionNotice());

describe("installedVersion — the version on disk, read now", () => {
	it("reads the version next to the build", () => {
		expect(installedVersion(pkg(JSON.stringify({ name: "@vincemakes/kiso-code", version: "0.40.4" })))).toBe("0.40.4");
	});

	it("a missing, corrupt or version-less file is null — never a guess, never a throw", () => {
		expect(installedVersion(join(tmpdir(), "kiso-no-such-dir-for-this-test", "package.json"))).toBeNull();
		expect(installedVersion(pkg("{ not json"))).toBeNull();
		expect(installedVersion(pkg(JSON.stringify({ name: "x" })))).toBeNull();
		expect(installedVersion(pkg(JSON.stringify({ version: 7 })))).toBeNull();
	});
});

describe("the notice — once per installed version that is not the running one", () => {
	it("an upgrade since start-up is said once, with the way back in", () => {
		expect(staleVersionNotice("0.40.3", "0.40.2", "2026-09-23T05-03-27-bfd9")).toBe(
			"✦ kiso 0.40.3 is installed — this session runs 0.40.2; exit and resume it (kiso resume 2026-09-23T05-03-27-bfd9) to use it",
		);
		expect(staleVersionNotice("0.40.3", "0.40.2", "s"), "the same install again: silent").toBeNull();
		expect(staleVersionNotice("0.40.4", "0.40.2", "s"), "a newer install: said again").toContain("kiso 0.40.4 is installed");
	});

	it("silent when they agree, when the disk cannot be read, and when the running version is unknown", () => {
		expect(staleVersionNotice("0.40.4", "0.40.4", "s")).toBeNull();
		expect(staleVersionNotice(null, "0.40.4", "s")).toBeNull();
		expect(staleVersionNotice("0.40.4", "?", "s")).toBeNull();
	});

	it("a rollback is said the same way — the session is not what a new start would run", () => {
		expect(staleVersionNotice("0.40.2", "0.40.4", "s")).toBe("✦ kiso 0.40.2 is installed — this session runs 0.40.4; exit and resume it (kiso resume s) to use it");
	});
});

describe("/status names the running version, and the installed one when they differ", () => {
	it("both forms", () => {
		expect(versionStatusLine("0.40.4", "0.40.4")).toBe("version 0.40.4");
		expect(versionStatusLine(null, "0.40.4")).toBe("version 0.40.4");
		expect(versionStatusLine("0.40.5", "0.40.4")).toBe("version 0.40.4 (running) · 0.40.5 installed — restart to use it");
	});
});
