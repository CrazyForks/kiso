/**
 * 0.40.5 — a session says when the kiso on disk is not the kiso it runs.
 *
 * The owner, 2026-09-23: "I am on 0.40.3 — why does edit_file still fail?"
 * The session's process had started at 13:03 on 0.40.2; 0.40.3 was
 * installed at ~14:05. The process kept the code it loaded, so its
 * edit_file still refused overlapping hunks, while `kiso --version` in
 * another shell printed the version ON DISK. Nothing in the session said
 * otherwise. A process that loads a module lazily after an upgrade (a
 * provider on its first /model switch) would also mix the new version with
 * the old — the notice is the cue to restart before that.
 *
 * `VERSION` (state.ts) is read once at start-up from the package.json next
 * to the build; a global install replaces that file, so reading it AGAIN
 * sees what a new start would run. One small read per turn and per
 * /status; no timer, no watcher, no network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The version of the kiso installed where this one was loaded from, read
 *  now — null on any failure, never a guess. KISO_INSTALLED_PACKAGE_JSON
 *  names another file: the test rigs' knob (like KISO_FAUX_SCRIPT), so an
 *  end-to-end run can "upgrade" underneath a live session without touching
 *  the checkout's own package.json. */
export function installedVersion(
	pkgPath: string = process.env.KISO_INSTALLED_PACKAGE_JSON ?? join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
): string | null {
	try {
		const v = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown }).version;
		return typeof v === "string" && v !== "" ? v : null;
	} catch {
		return null;
	}
}

let lastNoticed: string | null = null;

/** The transcript notice, once per installed version that differs from the
 *  running one (a newer install, or a rollback); null otherwise. */
export function staleVersionNotice(installed: string | null, running: string, sessionId: string): string | null {
	if (installed === null || installed === running || running === "?" || installed === lastNoticed) return null;
	lastNoticed = installed;
	return `✦ kiso ${installed} is installed — this session runs ${running}; exit and resume it (kiso resume ${sessionId}) to use it`;
}

/** /status's version line: the running version, and the installed one when
 *  they differ. */
export function versionStatusLine(installed: string | null, running: string): string {
	return installed === null || installed === running ? `version ${running}` : `version ${running} (running) · ${installed} installed — restart to use it`;
}

/** Tests: forget which version was noticed. */
export function resetStaleVersionNotice(): void {
	lastNoticed = null;
}
