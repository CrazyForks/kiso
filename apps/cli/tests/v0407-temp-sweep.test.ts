/**
 * 0.40.7 — the merge directories a killed kiso left behind are removed at
 * the next startup, and a live session's never are.
 *
 * `kiso-mcp-*` / `kiso-skills-*` were removed on a clean exit only; macOS's
 * temp cleaner leaves directories, so every `kill -9`'d session with project
 * mcp or skills left one for good. The name now carries the owner's pid.
 */
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli } from "../../../tests/helpers/isolated-cli.mjs";
import { LEGACY_MAX_AGE_MS, SWEEP_LIMIT, mergeDirPrefix, pidAlive, sweepStaleMergeDirs } from "../src/temp-sweep.js";

const DEAD = 4_000_001; // an owner the fake says is gone
const LIVE = 4_000_002; // one it says is running
const alive = (pid: number): boolean => pid === LIVE;
function tmp(): string {
	return mkdtempSync(join(tmpdir(), "kiso-sweep-"));
}
function dir(root: string, name: string, ageMs = 0): void {
	mkdirSync(join(root, name));
	writeFileSync(join(root, name, "mcp.json"), "{}");
	if (ageMs > 0) {
		const t = (Date.now() - ageMs) / 1000;
		utimesSync(join(root, name), t, t);
	}
}

describe("0.40.7: the stale merge-directory sweep", () => {
	it("removes a dead owner's directories; keeps a live owner's, this process's, and anything not ours", () => {
		const root = tmp();
		dir(root, `kiso-mcp-${DEAD}-a1B2c3`);
		dir(root, `kiso-skills-${DEAD}-z9Y8x7`);
		dir(root, `kiso-mcp-${LIVE}-q1W2e3`);
		dir(root, `kiso-skills-${process.pid}-r4T5y6`);
		dir(root, "kiso-sweep-other", 30 * 24 * 3600_000); // not a merge directory
		dir(root, "unrelated", 30 * 24 * 3600_000);
		writeFileSync(join(root, `kiso-mcp-${DEAD}-f1l2e3`), "a FILE with the name is not a merge directory");
		const removed = sweepStaleMergeDirs(root, Date.now(), alive).sort();
		expect(removed).toEqual([`kiso-mcp-${DEAD}-a1B2c3`, `kiso-skills-${DEAD}-z9Y8x7`]);
		expect(readdirSync(root).sort()).toEqual([`kiso-mcp-${DEAD}-f1l2e3`, `kiso-mcp-${LIVE}-q1W2e3`, `kiso-skills-${process.pid}-r4T5y6`, "kiso-sweep-other", "unrelated"].sort());
	});
	it("a legacy name (no pid) goes only after a week untouched", () => {
		const root = tmp();
		dir(root, "kiso-mcp-OLD123", LEGACY_MAX_AGE_MS + 3600_000);
		dir(root, "kiso-skills-NEW456", LEGACY_MAX_AGE_MS - 3600_000);
		expect(sweepStaleMergeDirs(root, Date.now(), alive)).toEqual(["kiso-mcp-OLD123"]);
		expect(readdirSync(root)).toEqual(["kiso-skills-NEW456"]);
	});
	it("one startup removes at most SWEEP_LIMIT; a temp dir it cannot read is no error", () => {
		const root = tmp();
		for (let i = 0; i < SWEEP_LIMIT + 5; i++) dir(root, `kiso-mcp-${DEAD}-${String(i).padStart(6, "0")}`);
		expect(sweepStaleMergeDirs(root, Date.now(), alive)).toHaveLength(SWEEP_LIMIT);
		expect(sweepStaleMergeDirs(join(root, "absent"), Date.now(), alive)).toEqual([]);
	});
	it("the prefix carries this process's pid; pidAlive knows this process and a pid that is gone", () => {
		expect(mergeDirPrefix("mcp")).toContain(`kiso-mcp-${process.pid}-`);
		expect(mergeDirPrefix("skills")).toContain(`kiso-skills-${process.pid}-`);
		expect(pidAlive(process.pid)).toBe(true);
		expect(pidAlive(2 ** 22 + 12345)).toBe(false);
	});
	it("wired: the built CLI's startup removes a gone owner's directory in its TMPDIR", () => {
		const root = tmp();
		const gone = 2 ** 22 + 23456; // no such process
		dir(root, `kiso-mcp-${gone}-a1B2c3`);
		dir(root, "kiso-skills-LEGACY", LEGACY_MAX_AGE_MS + 3600_000);
		const { env } = isolatedEnv({ TMPDIR: root });
		runCli(["chat", "sweep-e2e"], env, { input: "exit\n" });
		expect(readdirSync(root).filter((n) => n.startsWith("kiso-mcp-") || n.startsWith("kiso-skills-"))).toEqual([]);
	});
});
