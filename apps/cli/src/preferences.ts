/**
 * 0.40.6 — the choices kiso remembers for you, in
 * `<KISO_HOME>/preferences.json`.
 *
 * `config.json` is the human's file: kiso reads it and never writes it. A
 * choice made with a key — ctrl+t's thinking display, today the only one —
 * has to survive a restart, so it lands here instead: kiso-owned, private
 * (0600, tmp + rename), and read back at start-up. A missing or unreadable
 * file is an empty one; an unknown value is ignored rather than guessed.
 *
 * Nothing is read until the CLI's startup names the file
 * (`usePreferences`) — the same rule as learned-windows.ts, so in-process
 * tests never read a home directory.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { kisoHome } from "./state.js";

export interface Preferences {
	/** ctrl+t: the thinking blocks as one italic line each. Absent = shown. */
	readonly thinking?: "shown" | "hidden";
}

let prefs: Preferences | null = null;
let prefsPath: string | null = null;

export function preferencesPath(home: string = kisoHome()): string {
	return join(home, "preferences.json");
}

function read(path: string): Preferences {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as { thinking?: unknown };
		return raw.thinking === "shown" || raw.thinking === "hidden" ? { thinking: raw.thinking } : {};
	} catch {
		return {};
	}
}

/** Startup: read the file, and keep choices made from here on in it. */
export function usePreferences(path: string = preferencesPath()): void {
	prefsPath = path;
	prefs = read(path);
}

/** The remembered choices; empty before startup names the file. */
export function preferences(): Preferences {
	return prefs ?? {};
}

/** Remember a choice. Returns false when no file was named. The file is
 *  re-read before the write, so another process's choice is kept. */
export function setPreference<K extends keyof Preferences>(key: K, value: NonNullable<Preferences[K]>): boolean {
	const path = prefsPath;
	if (path === null) return false;
	const next: Preferences = { ...read(path), [key]: value };
	prefs = next;
	try {
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
		renameSync(tmp, path);
	} catch {
		// an unwritable home: the choice still holds for this process
	}
	return true;
}

/** Tests: back to the state before startup. */
export function resetPreferences(): void {
	prefs = null;
	prefsPath = null;
}
