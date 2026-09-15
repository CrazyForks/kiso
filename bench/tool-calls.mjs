/**
 * How many tool calls a leg made, and of what kind.
 *
 * No extractor produced this, and the edit-echo round turns on it: the
 * hypothesis is about READ CALLS, so the count is the measurement, not a
 * note beside one.
 *
 * UNKNOWN IS NOT ZERO — the rule this whole programme keeps relearning.
 * A leg whose log cannot be read returns `null`, never a zero count: zero
 * is the cheapest possible leg, so an unreadable log would win every
 * comparison it entered. Claude Code's `-p --output-format json` emits one
 * final result object and no per-call stream, so its tool calls are not
 * observable AT ALL from its own record — that arm returns null by
 * construction and says why, rather than reporting a number its log cannot
 * support.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const base = (p) => String(p ?? "").replace(/^.*\//, "");

/** One vocabulary across arms, so `read_file` and `read` are one column. */
const FAMILY = {
	read_file: "read", read: "read",
	write_file: "write", write: "write",
	edit_file: "edit", edit: "edit", apply_patch: "edit", multiedit: "edit",
	run_shell: "shell", bash: "shell", shell: "shell",
	search_text: "search", grep: "search", glob: "search",
	list_dir: "list", ls: "list",
	task_set: "task", todowrite: "task",
};
const family = (n) => FAMILY[String(n).toLowerCase()] ?? String(n).toLowerCase();

const MUTATES = new Set(["edit", "write"]);

/** Reduce an ordered call list to the counts the round is judged on. */
function summarise(calls) {
	const byFamily = {};
	let errorResults = 0;
	for (const c of calls) {
		byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
		if (c.failed) errorResults += 1;
	}
	// Reads of a file this leg had already edited, and reads that OPEN a
	// turn: the two shapes the paired round distinguishes.
	// A FAILED EDIT IS NOT THE BEHAVIOUR UNDER TEST. Reading a file after
	// an edit was REFUSED is the correct response to a refusal; reading it
	// after one SUCCEEDED is the thing a result that carried the file
	// would have made unnecessary. The first version counted both, and the
	// rate it produced showed a clean separation between two arms that
	// vanished the moment the refusals were taken out — a whole claim,
	// withdrawn, because the instrument conflated the behaviour with its
	// opposite.
	const editedOk = new Set();
	const firstOfTurn = new Map();
	let readsAfterOwnEdit = 0;
	let readsImmediatelyAfterOwnEdit = 0;
	let readsImmediatelyAfterFailedEdit = 0;
	let successfulMutations = 0;
	let turnOpeningReads = 0;
	for (let i = 0; i < calls.length; i += 1) {
		const c = calls[i];
		if (!firstOfTurn.has(c.turn)) {
			firstOfTurn.set(c.turn, c.family);
			if (c.family === "read") turnOpeningReads += 1;
		}
		if (MUTATES.has(c.family)) {
			if (!c.failed) {
				successfulMutations += 1;
				if (c.path) editedOk.add(c.path);
			}
			continue;
		}
		if (c.family !== "read" || !c.path) continue;
		if (editedOk.has(c.path)) readsAfterOwnEdit += 1;
		const prev = calls[i - 1];
		if (prev && MUTATES.has(prev.family) && prev.path === c.path) {
			if (prev.failed) readsImmediatelyAfterFailedEdit += 1;
			else readsImmediatelyAfterOwnEdit += 1;
		}
	}
	return {
		total: calls.length,
		byFamily,
		// NOT the same population as kiso's `tool_execution_failed` event,
		// and they must not share a name: this counts every result the
		// CALLER SAW AS AN ERROR, precondition refusals included (a stale
		// revision, a pattern that did not match). That is the population
		// that causes rework, which is what the round is about — one leg
		// reads 7 here and 6 by the execution-failure event, and the
		// difference is a refusal that never reached execution.
		errorResults,
		turns: firstOfTurn.size,
		turnOpeningReads,
		readsAfterOwnEdit,
		readsImmediatelyAfterOwnEdit,
		// the rework signal, kept apart from the one above
		readsImmediatelyAfterFailedEdit,
		successfulMutations,
	};
}

/** kiso: the durable session log. Arguments arrive as a delta stream. */
function kisoCalls(work) {
	const dir = join(work, "kiso-home", "sessions");
	let file;
	try {
		file = readdirSync(dir).find((x) => x.endsWith(".jsonl") && !x.includes("trace"));
	} catch {
		return null;
	}
	if (!file) return null;
	let text;
	try {
		text = readFileSync(join(dir, file), "utf8");
	} catch {
		return null;
	}
	const names = new Map(), args = new Map(), turnOf = new Map(), failed = new Set();
	const order = [];
	let turn = 0;
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let o;
		try { o = JSON.parse(line); } catch { continue; }
		const e = o.event ?? o;
		if (e.type === "user_input") turn += 1;
		else if (e.type === "tool_call_start") {
			names.set(e.callId, e.name);
			args.set(e.callId, "");
			turnOf.set(e.callId, turn);
			order.push(e.callId);
		} else if (e.type === "tool_call_input_delta") {
			if (args.has(e.callId)) args.set(e.callId, args.get(e.callId) + (e.inputJsonDelta ?? ""));
		} else if (e.type === "tool_result" && e.isError) failed.add(e.callId);
	}
	return order.map((id) => {
		let a = {};
		try { a = JSON.parse(args.get(id) ?? "{}"); } catch { /* a truncated stream is a call with no path */ }
		return {
			name: names.get(id),
			family: family(names.get(id)),
			path: base(a.path ?? a.file),
			turn: turnOf.get(id),
			failed: failed.has(id),
		};
	});
}

/** pi: one stdout-N.log per turn, each a JSON event stream. */
function piCalls(work) {
	let files;
	try {
		files = readdirSync(work).filter((x) => /^stdout-\d+\.log$/.test(x))
			.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
	} catch {
		return null;
	}
	if (files.length === 0) return null;
	const calls = [];
	const errored = new Set();
	for (const f of files) {
		const turn = Number(f.match(/\d+/)[0]);
		let text;
		try { text = readFileSync(join(work, f), "utf8"); } catch { continue; }
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			let o;
			try { o = JSON.parse(line); } catch { continue; }
			if (o.type === "tool_execution_start") {
				calls.push({
					id: o.toolCallId,
					name: o.toolName,
					family: family(o.toolName),
					path: base(o.args?.path ?? o.args?.file_path),
					turn,
					failed: false,
				});
			} else if (o.type === "tool_execution_end") {
				const bad = o.isError || o.error || o.result?.isError;
				if (bad) errored.add(o.toolCallId);
			}
		}
	}
	for (const c of calls) if (errored.has(c.id)) c.failed = true;
	return calls;
}

/**
 * The counts for one leg, or null with a reason.
 *
 * `{ observable: false, why }` is a THIRD answer beside a count and a
 * crash: it is the honest shape for an arm whose record cannot carry the
 * measurement, and it must never be folded into a number.
 */
export function toolCalls(work, tool) {
	if (tool === "claude") {
		return {
			observable: false,
			why: "claude -p --output-format json emits one final result object and no per-call stream",
		};
	}
	const calls = tool === "kiso" ? kisoCalls(work) : tool === "pi" ? piCalls(work) : null;
	if (calls === null) return { observable: false, why: `no readable ${tool} record under ${work}` };
	return { observable: true, ...summarise(calls) };
}
