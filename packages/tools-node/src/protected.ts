/**
 * kiso never serves its own credential store to a model.
 *
 * The 2026-09-14 incident: a session with its cwd at home called `read_file
 * .kiso/auth.json` in default mode. The read was auto-allowed, and the
 * store's API key and OAuth tokens went to the provider as conversation
 * context. `excludeRoots` could not have stopped it — it governs what a walk
 * DISCOVERS, not what a named path may ACCESS (its own header says so).
 *
 * This is the access rule, for the files the host names (`protectedFiles`):
 * the credential store and its name-suffixed siblings (the writer's temp
 * file and lock), plus whatever a user lists in their own config. A path is
 * protected when the DISK resolves it to one of them — `realpath.native` of
 * the longest existing prefix, so a symlink, a `..` through a symlink and a
 * case variant all reach the same file — or when it is the same INODE (a
 * hard link under another name).
 *
 * This module imports nothing beyond node itself, as secret-env.ts does:
 * the same rule is read by the search worker and by the CLI's shell check.
 */

import { basename, dirname, join } from "node:path";
import { realpathSync, statSync } from "node:fs";

export const PROTECTED_REFUSAL = "kiso never serves its own credential store to a model";

/** The path as the disk resolves it: realpath.native of the longest
 *  existing prefix, then the tail that does not exist yet. */
export function diskPath(p: string): string {
	let head = p;
	const tail: string[] = [];
	for (;;) {
		try {
			const real = realpathSync.native(head);
			return tail.length > 0 ? join(real, ...tail) : real;
		} catch {
			const parent = dirname(head);
			if (parent === head) return p;
			tail.unshift(basename(head));
			head = parent;
		}
	}
}

export interface ProtectedIdentity {
	/** the protected files as the disk spells them */
	readonly paths: readonly string[];
	/** `dev:ino` of each protected file that exists — a hard link is the same file */
	readonly inodes: readonly string[];
}

/** Resolve the protected list once; the per-path checks compare against it. */
export function protectedIdentity(files: readonly string[] = []): ProtectedIdentity {
	const paths = files.map(diskPath);
	const inodes: string[] = [];
	for (const p of paths) {
		try {
			const st = statSync(p);
			if (st.isFile()) inodes.push(`${st.dev}:${st.ino}`);
		} catch {
			// not there yet — the path rule still holds
		}
	}
	return { paths, inodes };
}

/** Whether a disk-resolved path is a protected file or one of its
 *  name-suffixed siblings (`auth.json.tmp-<pid>`, `auth.json.lock/…`). */
export function isProtectedDiskPath(d: string, id: ProtectedIdentity): boolean {
	return id.paths.some((pf) => d === pf || d.startsWith(`${pf}.`));
}

/** The whole question for one path: by where the disk resolves it, and by
 *  inode when it exists. */
export function isProtectedPath(p: string, id: ProtectedIdentity): boolean {
	if (id.paths.length === 0) return false;
	const d = diskPath(p);
	if (isProtectedDiskPath(d, id)) return true;
	if (id.inodes.length === 0) return false;
	try {
		const st = statSync(d);
		return st.isFile() && id.inodes.includes(`${st.dev}:${st.ino}`);
	} catch {
		return false;
	}
}

/** The refusal a tool returns — a precondition (refused, never attempted),
 *  stated as permanent so a model does not retry it under another name. */
export function protectedRefusalText(tool: string, path: string): string {
	return `${tool}: ${path} — ${PROTECTED_REFUSAL}. This is permanent: do not retry it, under this path or another.`;
}
