/**
 * 0.40.7 — the merge directories a killed kiso left behind.
 *
 * A project with its own `.kiso/mcp.json` or skills gets a merged copy in
 * the temp directory (`kiso-mcp-*`, `kiso-skills-*`, trust-ui.ts). A clean
 * exit removes it; `kill -9` does not, and macOS's temp cleaner removes old
 * FILES but leaves directories — so every killed session left one behind
 * for good (the owner's machine once held 449,956 of the test suite's).
 *
 * The directory's name now carries its owner's pid
 * (`kiso-mcp-<pid>-XXXXXX`). At startup kiso removes the ones whose owner
 * is gone; a live session's directory is never touched. Names from before
 * this version carry no pid: those are removed only when untouched for a
 * week, which no live session's merge can be (it is read at every reload).
 * Only directories this user owns are considered; nothing else in the
 * temp directory is read.
 */
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LEGACY_MAX_AGE_MS = 7 * 24 * 3600_000;
/** One startup never spends long here, whatever the temp directory holds. */
export const SWEEP_LIMIT = 200;

const OWNED = /^kiso-(?:mcp|skills)-(\d+)-[A-Za-z0-9]{6}$/;
const LEGACY = /^kiso-(?:mcp|skills)-[A-Za-z0-9]{6}$/;

/** The mkdtemp prefix for a merge directory: this process's pid in the name. */
export function mergeDirPrefix(kind: "mcp" | "skills"): string {
	return join(tmpdir(), `kiso-${kind}-${process.pid}-`);
}

/** Is a process with this pid running? EPERM means it is, and belongs to
 *  someone else; only ESRCH says it is gone. */
export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Remove the merge directories whose owner is gone (and legacy ones a week
 *  old). Returns the names removed. Every failure is skipped — a sweep is
 *  housekeeping, never a reason for a session not to start. */
export function sweepStaleMergeDirs(dir: string = tmpdir(), now: number = Date.now(), alive: (pid: number) => boolean = pidAlive): string[] {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
	const removed: string[] = [];
	for (const name of names) {
		if (removed.length >= SWEEP_LIMIT) break;
		const owned = OWNED.exec(name);
		if (owned === null && !LEGACY.test(name)) continue;
		const full = join(dir, name);
		try {
			const st = lstatSync(full);
			if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) continue;
			const stale = owned !== null ? Number(owned[1]) !== process.pid && !alive(Number(owned[1])) : now - st.mtimeMs > LEGACY_MAX_AGE_MS;
			if (!stale) continue;
			rmSync(full, { recursive: true, force: true });
			removed.push(name);
		} catch {
			// gone already, or not ours to remove
		}
	}
	return removed;
}
