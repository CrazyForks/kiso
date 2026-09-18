/**
 * 0.40.0 — the one-time move of the legacy `KISO_HOME/sessions` into the
 * per-project folders (see projects.ts). The lead's conditions, in order:
 *
 *   1. the manifest is written FIRST: every session's old folder, new
 *      folder, reason and evidence, before any file moves;
 *   2. a session whose lock a live process holds is skipped, and moved on a
 *      later start;
 *   3. a recorded workspace places a session; otherwise the paths its tools
 *      touched, mapped to their repository on disk, place it when one root
 *      has at least 3 mentions and 80% of them; anything else goes to
 *      `_unknown`. A delegated child follows its parent;
 *   4. the move is announced once, naming the reverse command.
 *
 * Each session moves trace → sidecar → lock → log (projects.ts), so a crash
 * leaves the log in the legacy folder, where the next start finds it again.
 * Nothing is deleted: files the move does not own (orphan sidecars, the
 * delegation artifacts, whose paths the parents' logs record) stay where
 * they are.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readProfile } from "@vincemakes/kiso-runtime/internal";
import {
	canonicalPath,
	claimProjectDir,
	hasSession,
	LEGACY_SESSIONS_DIR,
	lockHeldLive,
	moveSessionFiles,
	parentOfChild,
	projectDirFor,
	PROJECTS_DIR,
	REVERSED_MARKER,
	sessionFiles,
	unknownDir,
} from "./projects.js";

export type PlacementReason = "recorded" | "inferred" | "unknown" | "skipped-live";

export interface Placement {
	readonly id: string;
	readonly reason: PlacementReason;
	/** the project the session goes to; null → `_unknown` (or, when
	 *  skipped, nowhere yet) */
	readonly workspace: string | null;
	readonly from: string;
	readonly to: string | null;
	/** for `inferred`, and for the near misses that went to `_unknown` */
	readonly evidence?: { readonly root: string; readonly mentions: number; readonly total: number };
	/** a delegated child follows this session */
	readonly parent?: string;
}

/** The inference's two thresholds (the lead's ruling). */
export const INFER_MIN_MENTIONS = 3;
export const INFER_MIN_SHARE = 0.8;

/** The legacy sessions still to move: non-empty logs, sorted. */
export function pendingLegacyIds(home: string): string[] {
	const dir = join(home, LEGACY_SESSIONS_DIR);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.endsWith(".jsonl"))
		.map((e) => e.slice(0, -".jsonl".length))
		.filter((id) => hasSession(dir, id))
		.sort();
}

/** An absolute path inside a tool's input or output. The leading guard
 *  keeps a URL's path (`https://x/y`) and a relative path's tail out. */
const ABS_PATH = /(?<![\w.:/~-])\/[^\s'"`;|&<>(){}[\],*?$\\]+/g;

/**
 * The repository a path belongs to: the nearest ancestor holding `.git`.
 * A linked worktree (`.git` is a file naming `<repo>/.git/worktrees/x`)
 * belongs to its main repository. Walks stop at the home directory, and
 * paths inside KISO_HOME belong to no project.
 */
export function repoRootOf(path: string, cache: Map<string, string | null>, stops: { readonly home: string; readonly kisoHome: string }): string | null {
	if (path === stops.kisoHome || path.startsWith(`${stops.kisoHome}/`)) return null;
	const walked: string[] = [];
	let dir = path;
	let root: string | null = null;
	for (;;) {
		const known = cache.get(dir);
		if (known !== undefined) {
			root = known;
			break;
		}
		walked.push(dir);
		if (dir === "/" || dir === stops.home) break;
		const git = join(dir, ".git");
		if (existsSync(git)) {
			root = dir;
			try {
				if (statSync(git).isFile()) {
					const m = /^gitdir:\s*(.+?)\/\.git\/worktrees\/[^/]+\s*$/m.exec(readFileSync(git, "utf8"));
					if (m !== null) root = m[1]!;
				}
			} catch {
				// unreadable `.git` file — the directory itself is the root
			}
			// as the disk spells it: a log that wrote `~/desktop/x` and one
			// that wrote `~/Desktop/x` name one repository
			root = canonicalPath(root);
			break;
		}
		dir = dirname(dir);
	}
	for (const d of walked) cache.set(d, root);
	return root;
}

/** The absolute paths one log's tool calls and tool results name. */
export function toolPaths(logText: string): string[] {
	const out: string[] = [];
	for (const line of logText.split("\n")) {
		if (line === "") continue;
		let event: { readonly type?: unknown; readonly input?: unknown; readonly content?: unknown };
		try {
			event = (JSON.parse(line) as { readonly event?: typeof event }).event ?? {};
		} catch {
			continue; // a torn line
		}
		if (event.type !== "tool_call_end" && event.type !== "tool_result") continue;
		const text = JSON.stringify(event.type === "tool_call_end" ? event.input : event.content) ?? "";
		for (const m of text.replaceAll("\\n", "\n").replaceAll("\\t", "\t").matchAll(ABS_PATH)) out.push(m[0]);
	}
	return out;
}

/** The inference over one log: the dominant repository and its counts. */
export function inferWorkspace(
	logText: string,
	cache: Map<string, string | null>,
	stops: { readonly home: string; readonly kisoHome: string },
): { readonly root: string; readonly mentions: number; readonly total: number; readonly placed: boolean } | null {
	const counts = new Map<string, number>();
	for (const path of toolPaths(logText)) {
		const root = repoRootOf(path, cache, stops);
		if (root !== null) counts.set(root, (counts.get(root) ?? 0) + 1);
	}
	let best: [string, number] | null = null;
	let total = 0;
	for (const entry of counts) {
		total += entry[1];
		if (best === null || entry[1] > best[1]) best = entry;
	}
	if (best === null) return null;
	return { root: best[0], mentions: best[1], total, placed: best[1] >= INFER_MIN_MENTIONS && best[1] / total >= INFER_MIN_SHARE };
}

/**
 * The plan: where every pending legacy session goes, and why. A pure read
 * of the legacy folder and the repositories on disk — nothing is written,
 * so the owner's dry run is this function over a copy.
 */
export function planMigration(home: string, opts: { readonly userHome?: string } = {}): Placement[] {
	const legacy = join(home, LEGACY_SESSIONS_DIR);
	const ids = pendingLegacyIds(home);
	const stops = { home: opts.userHome ?? homedir(), kisoHome: home };
	const cache = new Map<string, string | null>();
	// an earlier run's decision stands: that run may have moved the sidecar
	// (which holds the recorded workspace) and crashed before the log, and a
	// re-decision from what is left would send the log somewhere else
	const earlier = earlierDecisions(home);
	const decided = new Map<string, Omit<Placement, "to"> & { readonly to?: string }>();
	const decide = (id: string): Omit<Placement, "to"> & { readonly to?: string } => {
		const done = decided.get(id);
		if (done !== undefined) return done;
		let placement: Omit<Placement, "to"> & { readonly to?: string };
		const parent = parentOfChild(id);
		const profile = readProfile(legacy, id);
		const recorded = profile.kind === "ok" ? profile.profile.workspace : null;
		const prior = earlier.get(id);
		if (lockHeldLive(legacy, id)) {
			placement = { id, reason: "skipped-live", workspace: null, from: legacy };
		} else if (prior !== undefined) {
			placement = { ...prior, from: legacy };
		} else if (parent !== null && ids.includes(parent)) {
			// a child follows its parent — unless the parent is open, and then
			// the child waits with it
			const p = decide(parent);
			placement = { id, reason: p.reason, workspace: p.workspace, from: legacy, parent, ...(p.evidence !== undefined ? { evidence: p.evidence } : {}) };
		} else if (recorded !== null) {
			placement = { id, reason: "recorded", workspace: canonicalPath(recorded), from: legacy };
		} else {
			let text = "";
			try {
				text = readFileSync(join(legacy, `${id}.jsonl`), "utf8");
			} catch {
				// unreadable — no evidence, so no project
			}
			const inferred = inferWorkspace(text, cache, stops);
			placement =
				inferred !== null && inferred.placed
					? { id, reason: "inferred", workspace: inferred.root, from: legacy, evidence: { root: inferred.root, mentions: inferred.mentions, total: inferred.total } }
					: { id, reason: "unknown", workspace: null, from: legacy, ...(inferred !== null ? { evidence: { root: inferred.root, mentions: inferred.mentions, total: inferred.total } } : {}) };
		}
		decided.set(id, placement);
		return placement;
	};
	// the target folders, assigned in one pass so two workspaces that encode
	// alike get distinct folders before either exists on disk
	const taken = new Map<string, string>();
	const dirOf = new Map<string, string>();
	const target = (workspace: string | null): string => {
		if (workspace === null) return unknownDir(home);
		const known = dirOf.get(workspace);
		if (known !== undefined) return known;
		const dir = projectDirFor(home, workspace, taken);
		taken.set(dir, workspace);
		dirOf.set(workspace, dir);
		return dir;
	};
	const plan = ids.map((id): Placement => {
		const p = decide(id);
		return { ...p, to: p.reason === "skipped-live" ? null : (p.to ?? target(p.workspace)) };
	});
	// children move before their parent: a crash between them leaves the
	// parent — whose log is the one a person resumes — still listed
	return [...plan.filter((p) => p.parent !== undefined), ...plan.filter((p) => p.parent === undefined)];
}

/** Every earlier manifest's placements that were not skips, the latest
 *  first-come: id → where it was going. */
function earlierDecisions(home: string): Map<string, Placement & { readonly to: string }> {
	const out = new Map<string, Placement & { readonly to: string }>();
	const dir = join(home, PROJECTS_DIR);
	let names: string[];
	try {
		names = readdirSync(dir).filter((n) => n.startsWith("migration-") && n.endsWith(".json"));
	} catch {
		return out;
	}
	for (const name of names.sort().reverse()) {
		try {
			const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as { readonly entries?: readonly Placement[] };
			for (const e of parsed.entries ?? []) {
				if (e.to === null || e.reason === "skipped-live" || out.has(e.id)) continue;
				out.set(e.id, e as Placement & { readonly to: string });
			}
		} catch {
			// an unreadable manifest decides nothing
		}
	}
	return out;
}

export interface MigrationCounts {
	readonly recorded: number;
	readonly inferred: number;
	readonly unknown: number;
	readonly skippedLive: number;
}

export function countPlan(plan: readonly Placement[]): MigrationCounts {
	const n = (r: PlacementReason): number => plan.filter((p) => p.reason === r).length;
	return { recorded: n("recorded"), inferred: n("inferred"), unknown: n("unknown"), skippedLive: n("skipped-live") };
}

export interface MigrationResult {
	readonly manifest: string;
	readonly counts: MigrationCounts;
	readonly moved: number;
}

/**
 * Run the plan. The manifest lands before the first move; after the moves
 * it is rewritten with each entry's outcome. Returns null when there was
 * nothing to move (all skipped, or nothing pending).
 */
export function runMigration(home: string, plan: readonly Placement[], now: Date = new Date()): MigrationResult | null {
	const movable = plan.filter((p) => p.to !== null);
	if (movable.length === 0) return null;
	const root = join(home, PROJECTS_DIR);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const manifest = join(root, `migration-${now.toISOString().replace(/[:.]/g, "-")}.json`);
	const write = (entries: readonly object[], completedAt: string | null): void => {
		const tmp = `${manifest}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify({ version: 1, startedAt: now.toISOString(), completedAt, entries }, null, 1)}\n`, { mode: 0o600 });
		renameSync(tmp, manifest);
	};
	write(plan, null);
	let moved = 0;
	const outcomes = plan.map((p) => {
		if (p.to === null) return { ...p, moved: false };
		claimProjectDir(p.to, p.workspace);
		// a session that became open since the plan was made waits too
		if (lockHeldLive(p.from, p.id)) return { ...p, moved: false, skipped: "opened during the move" };
		moveSessionFiles(p.from, p.to, p.id);
		const ok = hasSession(p.to, p.id) && !existsSync(join(p.from, `${p.id}.jsonl`));
		if (ok) moved += 1;
		return { ...p, moved: ok };
	});
	write(outcomes, new Date().toISOString());
	return { manifest, counts: countPlan(plan), moved };
}

/** The announcement, once per migration that moved something. */
export function migrationNotice(result: MigrationResult): string {
	const c = result.counts;
	const parts = [`recorded ${c.recorded}`, `inferred ${c.inferred}`, `unknown ${c.unknown}`, ...(c.skippedLive > 0 ? [`still open ${c.skippedLive}, moved later`] : [])];
	return `sessions now live in one folder per project — moved ${result.moved} (${parts.join(" · ")}); undo: kiso sessions --reverse-migration ${result.manifest}`;
}

/**
 * `kiso sessions --reverse-migration <manifest>`: every entry the manifest
 * moved goes back to the legacy folder, the log FIRST (so a crash leaves it
 * listed from its old place), and the marker switches the per-project
 * layout off. Sessions created in project folders after the migration are
 * not in the manifest and stay; the count says so.
 */
export function reverseMigration(home: string, manifestPath: string): { readonly restored: number; readonly left: number } {
	const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { readonly entries?: readonly Placement[] };
	const entries = (parsed.entries ?? []).filter((e) => e.to !== null);
	let restored = 0;
	// parents first, then children: the reverse of the forward order
	for (const e of [...entries.filter((x) => x.parent === undefined), ...entries.filter((x) => x.parent !== undefined)]) {
		if (e.to === null || !existsSync(join(e.to, `${e.id}.jsonl`))) continue;
		moveSessionFiles(e.to, e.from, e.id, [...sessionFiles(e.id)].reverse());
		if (hasSession(e.from, e.id)) restored += 1;
	}
	mkdirSync(join(home, PROJECTS_DIR), { recursive: true, mode: 0o700 });
	writeFileSync(join(home, PROJECTS_DIR, REVERSED_MARKER), `${new Date().toISOString()} ${manifestPath}\n`, { mode: 0o600 });
	let left = 0;
	const root = join(home, PROJECTS_DIR);
	for (const name of readdirSync(root)) {
		const dir = join(root, name);
		try {
			if (!statSync(dir).isDirectory()) continue;
			left += readdirSync(dir).filter((f) => f.endsWith(".jsonl") && hasSession(dir, f.slice(0, -".jsonl".length))).length;
		} catch {
			// unreadable folder — not counted
		}
	}
	return { restored, left };
}
