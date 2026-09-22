/**
 * ADR-0055 Amendment 1 (A1b) — the in-run compaction policy, as data and
 * pure decisions. The kernel only asks, before every request, what to
 * append (LoopConfig.compact); this module answers the WHEN, and the
 * session supplies the summary itself (session.ts compactionPoint).
 *
 * Every number here is a stated position, not a measurement, and the ADR
 * says so: the tiers are the owner's ruling, the phase detector is a
 * heuristic over round shapes that is reported and never proven, and the
 * prune's break-even is arithmetic on one price table.
 */
import { DO_NOT_COMPACT, MICROCOMPACTABLE, type Event } from "@vincemakes/kiso-core";
import { estimateEventTokens } from "./summarize.js";

/** A1: soft makes compaction eligible (it waits for a phase end), hard
 *  fires at the next settled round, emergency before the next request.
 *  Emergency is `max(window − reserve, hard)` (the lead, 2026-09-18), so
 *  soft ≤ hard ≤ emergency always holds: a small window never goes
 *  negative, and DeepSeek's 384K max output on a 1M window puts emergency
 *  at hard (700K) — an output over 300K is left to the one overflow
 *  recovery. A5: the raw tail stays v1's `min(0.1·window, 100K)`. */
export interface Tiers {
	readonly soft: number;
	readonly hard: number;
	readonly emergency: number;
	readonly tail: number;
}

/** ADR-0055 Amendment 2 (decision 4): the output an endpoint may grant when
 *  neither kiso nor the registry states one. kiso sends no `max_tokens`
 *  where it sends none today, so the endpoint's own default applies — and
 *  the one default observed is 131,072 (the op gateway's refusal on
 *  2026-09-22: "you requested 131072 output tokens" with no max_tokens
 *  sent). Reserving 32K there put the emergency tier 99K too high. */
export const UNKNOWN_MAX_OUTPUT = 131_072;

/** The emergency reserve: what the request asks for when kiso sends a
 *  `max_tokens`, else the registry's max output for the served endpoint,
 *  else UNKNOWN_MAX_OUTPUT — never below the summary budget. */
export function outputReserve(maxTokens: number | undefined, registryMaxOutput: number | null | undefined, floor: number): number {
	return Math.max(maxTokens ?? registryMaxOutput ?? UNKNOWN_MAX_OUTPUT, floor);
}

export function tiersFor(windowTokens: number, reserve: number): Tiers {
	return {
		soft: Math.min(0.5 * windowTokens, 400_000),
		hard: Math.min(0.8 * windowTokens, 700_000),
		emergency: Math.max(windowTokens - reserve, Math.min(0.8 * windowTokens, 700_000)),
		tail: Math.min(0.1 * windowTokens, 100_000),
	};
}

/**
 * A1 — which tier a measured context is past, the most urgent first; the
 * soft tier asks the phase detector. Null: no tier is crossed. Emergency
 * only where it stands STRICTLY above hard (the lead, A1B-M1): at the
 * clamp the two coincide, and that fire is hard — not prune-eligible.
 */
export function tierReason(used: number, t: Tiers, why: "request" | "overflow", phase: () => string | null): string | null {
	if (why === "overflow") return "overflow";
	if (used > t.emergency && t.emergency > t.hard) return "emergency";
	if (used > t.hard) return "hard";
	if (used > t.soft) return phase();
	return null;
}

/**
 * A3 rule 1's runners — the lead's table, matched on a command's first
 * words once leading `VAR=value` assignments and the plain wrappers are
 * stripped. A shell call not on it is not a test run. The CLI puts the
 * user's configured `checks` in front of it.
 */
export const TEST_RUNNERS: readonly string[] = [
	"npm test", "npm run test", "pnpm test", "yarn test", "bun test", "npx vitest", "npx jest", "npx mocha", "node --test",
	"pytest", "python -m pytest", "go test", "cargo test", "make test", "mvn test", "gradle test", "dotnet test", "rspec",
	"phpunit", "mix test", "swift test",
];
const WRAPPERS = new Set(["env", "time", "nice", "nohup", "command", "exec", "sudo"]);

/** Whether one shell command line runs a check: any `&&`/`;`/`|` segment
 *  whose leading words, past assignments and wrappers, start a runner. */
export function runsACheck(command: string, extra: readonly string[] = []): boolean {
	const runners = [...extra, ...TEST_RUNNERS];
	return command.split(/&&|\|\||;|\|/).some((segment) => {
		const words = segment.trim().split(/\s+/);
		while (words.length > 0 && (WRAPPERS.has(words[0]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!))) words.shift();
		if (words[0] === "timeout") words.splice(0, 2);
		const line = words.join(" ");
		return runners.some((r) => line === r || line.startsWith(`${r} `));
	});
}

const EDIT_TOOLS = new Set(["write_file", "edit_file"]);
const READ_TOOLS = new Set(["read_file", "list_dir", "search_text", "read_skill"]);

type Round = { readonly edits: boolean; readonly readsOnly: boolean; readonly check: boolean };

/**
 * A3 — does the LAST settled round end a phase? The rounds are the model
 * turns since the last boundary, read off their tool calls. A new user
 * turn since the last round is a phase end of its own. Returns the rule
 * that fired, for the record, or null.
 */
export function phaseEnd(events: readonly Event[], sinceSeq: number, isCheck: (command: string) => boolean): string | null {
	const rounds: Round[] = [];
	let calls: (Event & { type: "tool_call_end" })[] = [];
	let userAfterLastRound = false;
	for (const e of events) {
		if (e.seq <= sinceSeq) continue;
		if (e.type === "tool_call_end") calls.push(e);
		else if (e.type === "user_input") userAfterLastRound = true;
		else if (e.type === "stop" && calls.length > 0) {
			rounds.push({
				edits: calls.some((c) => EDIT_TOOLS.has(c.name)),
				readsOnly: calls.every((c) => READ_TOOLS.has(c.name)),
				check: calls.some((c) => (c.name === "shell" && typeof c.input?.command === "string" && isCheck(c.input.command)) || (c.name === "delegate" && c.input?.check !== undefined)),
			});
			calls = [];
			userAfterLastRound = false;
		}
	}
	if (userAfterLastRound) return "phase:turn";
	const last = rounds.at(-1);
	const prev = rounds.at(-2);
	if (last === undefined) return null;
	if (last.check) return "phase:check";
	if (prev !== undefined && prev.edits && !last.edits) return "phase:edits-done";
	if (prev !== undefined && prev.readsOnly && last.edits) return "phase:reads-done";
	return null;
}

/** The default number of the newest compactable results a prune keeps. */
export const KEEP_COMPACTABLE_RESULTS = 4;

/**
 * The prune primitive's boundary (moved unchanged from the kernel, where
 * the standing trigger that used it was removed — A4): drawn by
 * compactable-result recentness, never user turns. The newest
 * `keepResults` still-visible compactable results stay; the boundary is
 * the (K+1)th-newest. A do-not-compact result is uncountable, exactly as
 * the projection refuses to clear it. Undefined when nothing would clear.
 */
export function microcompactBoundarySeq(events: readonly Event[], keepResults: number = KEEP_COMPACTABLE_RESULTS): number | undefined {
	const callName = new Map<string, string>();
	let lastCleared = -1;
	for (const ev of events) {
		if (ev.type === "tool_call_end") callName.set(ev.callId, ev.name);
		if (ev.type === "microcompacted" && ev.beforeSeq > lastCleared) lastCleared = ev.beforeSeq;
	}
	const visible: number[] = [];
	for (const ev of events) {
		if (ev.type !== "tool_result" || ev.seq <= lastCleared) continue;
		const name = callName.get(ev.callId);
		if (name !== undefined && MICROCOMPACTABLE.has(name) && !(ev.tags ?? []).includes(DO_NOT_COMPACT)) visible.push(ev.seq);
	}
	if (visible.length <= keepResults) return undefined;
	return visible[visible.length - keepResults - 1]!;
}

/** A4(c): the requests a run is assumed to have left when nothing better
 *  is known — a stated position, not a prediction. */
export const REQUESTS_ASSUMED_LEFT = 50;

/**
 * A4(c) — a prune that drops `dropped` tokens and re-sends `keptAfter`
 * tokens cold (everything after the first cleared result) pays only if at
 * least `factor · keptAfter / dropped` requests follow. `factor` is
 * (miss − hit) / hit from the model's price table: 49 at DeepSeek V4.1
 * Flash off-peak (0.15 and 0.003 per million, 2026-09-19).
 */
export function pruneBreaksEven(dropped: number, keptAfter: number, factor: number, requestsLeft: number = REQUESTS_ASSUMED_LEFT): boolean {
	if (dropped <= 0) return false;
	return requestsLeft >= (factor * keptAfter) / dropped;
}

/** The factor for a price table: (miss − hit) / hit, or 49 (the DeepSeek
 *  V4.1 Flash off-peak figure) when the table cannot say. */
export function breakEvenFactor(missPerMillion: number | undefined, hitPerMillion: number | undefined): number {
	if (missPerMillion === undefined || hitPerMillion === undefined || hitPerMillion <= 0) return 49;
	return (missPerMillion - hitPerMillion) / hitPerMillion;
}

/**
 * A4(b) with its (c) guard — the emergency prune, only where it pays. D is
 * what the clear drops (the clearable results up to the boundary), S what
 * is re-sent cold (everything from the first cleared result on, minus D).
 * Undefined: nothing to clear, or too few requests left to earn it back.
 */
export function guardedPruneSeq(events: readonly Event[], factor: number, requestsLeft: number = REQUESTS_ASSUMED_LEFT, keepResults: number = KEEP_COMPACTABLE_RESULTS): number | undefined {
	const beforeSeq = microcompactBoundarySeq(events, keepResults);
	if (beforeSeq === undefined) return undefined;
	const callName = new Map<string, string>();
	let lastCleared = -1;
	for (const ev of events) {
		if (ev.type === "tool_call_end") callName.set(ev.callId, ev.name);
		if (ev.type === "microcompacted" && ev.beforeSeq > lastCleared) lastCleared = ev.beforeSeq;
	}
	let dropped = 0;
	let first: number | undefined;
	for (const ev of events) {
		if (ev.type !== "tool_result" || ev.seq <= lastCleared || ev.seq > beforeSeq) continue;
		const name = callName.get(ev.callId);
		if (name === undefined || !MICROCOMPACTABLE.has(name) || (ev.tags ?? []).includes(DO_NOT_COMPACT)) continue;
		dropped += estimateEventTokens(ev);
		first ??= ev.seq;
	}
	if (first === undefined) return undefined;
	let after = 0;
	for (const ev of events) if (ev.seq >= first) after += estimateEventTokens(ev);
	return pruneBreaksEven(dropped, after - dropped, factor, requestsLeft) ? beforeSeq : undefined;
}
