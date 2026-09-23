/**
 * CW-1 batch 2 — the windows endpoints have STATED by refusing a request,
 * kept across sessions in `<KISO_HOME>/learned-windows.json`.
 *
 * A refusal like "maximum context length is 1048576 tokens" is the one
 * window source that is right for any route, relays included (the runtime
 * reads it: window-learner.ts). The runtime's tiers take it at once; this
 * file keeps it, so the next session starts on the real figure instead of
 * meeting the wall again. It sits in the window chain after what the user
 * set and before the registry: a measurement of this endpoint beats a
 * statement about the model.
 *
 * Keyed by the endpoint (the baseUrl, trailing slashes dropped — a
 * forwarder can send two paths to two upstreams) and the model id. A
 * figure only ever goes DOWN for a key: a later, larger refusal cannot
 * widen what a route already refused. The file is private (0600, tmp +
 * rename); a missing or unreadable file is an empty one — the chain falls
 * through to the registry, as it did before anything was learned.
 *
 * Nothing is read until the CLI's startup names the file
 * (`useLearnedWindows`): the window chain is library code that in-process
 * tests call, and a chain that read `~/.kiso` on its own would make their
 * verdict depend on the machine they run on.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { kisoHome } from "./state.js";

export interface LearnedWindow {
	readonly tokens: number;
	/** the day the refusal was read, YYYY-MM-DD */
	readonly observedAt: string;
}

type Table = Record<string, LearnedWindow>;

let table: Table | null = null;
let tablePath: string | null = null;

export function learnedWindowsPath(home: string = kisoHome()): string {
	return join(home, "learned-windows.json");
}

/** The key for one model at one endpoint; no baseUrl is the provider's own. */
export function learnedKey(model: string, baseUrl: string | undefined): string {
	return `${baseUrl === undefined ? "-" : baseUrl.replace(/\/+$/, "")} ${model}`;
}

function read(path: string): Table {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const out: Table = {};
		for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
			const w = v as Partial<LearnedWindow> | null;
			if (w !== null && typeof w === "object" && typeof w.tokens === "number" && Number.isSafeInteger(w.tokens) && w.tokens > 0 && typeof w.observedAt === "string") {
				out[k] = { tokens: w.tokens, observedAt: w.observedAt };
			}
		}
		return out;
	} catch {
		return {};
	}
}

/** Startup: read the file and keep figures learned from here on in it.
 *  Until this is called, nothing is read and nothing is kept. */
export function useLearnedWindows(path: string = learnedWindowsPath()): void {
	tablePath = path;
	table = read(path);
}

/** The learned window for a model at an endpoint, if a refusal stated one. */
export function learnedWindowFor(model: string, baseUrl: string | undefined): LearnedWindow | undefined {
	return table === null ? undefined : table[learnedKey(model, baseUrl)];
}

/**
 * Keep a refusal's cap. Returns true when it changed what is kept (a new
 * key, or a smaller figure), false when a figure at or below it is kept
 * already — or when no file was named (`useLearnedWindows`). The file is
 * re-read before the write, so a figure another process learned meanwhile
 * is not lost.
 */
export function recordLearnedWindow(model: string, baseUrl: string | undefined, tokens: number, today: Date = new Date()): boolean {
	const path = tablePath;
	if (path === null) return false;
	const key = learnedKey(model, baseUrl);
	const current = read(path);
	const held = current[key];
	if (held !== undefined && held.tokens <= tokens) {
		table = current;
		return false;
	}
	const next: Table = { ...current, [key]: { tokens, observedAt: today.toISOString().slice(0, 10) } };
	table = next;
	try {
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
		renameSync(tmp, path);
	} catch {
		// unwritable home: the figure still holds for this process
	}
	return true;
}

/** Tests: back to the state before startup — nothing read, nothing kept. */
export function resetLearnedWindows(): void {
	table = null;
	tablePath = null;
}
