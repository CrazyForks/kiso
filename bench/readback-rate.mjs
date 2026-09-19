#!/usr/bin/env node
/**
 * The repeat-edit READ-BACK RATE — the primary metric of the re-read
 * exemption round.
 *
 *   of the edits to a file this leg has ALREADY edited, the share preceded
 *   by a read_file of that file since the previous edit of it.
 *
 * Measured on the six T6 legs on disk: 62/168 = 36.9% ours, 16/128 = 12.5%
 * theirs. The round asks whether one sentence in the prompt moves ours.
 *
 * Two properties this file exists to hold, each with a red proof in
 * tests/test_readback_rate.mjs:
 *
 *  1. A FAILED CALL IS ONE CALL. Our runtime emits BOTH a `tool_result`
 *     carrying isError AND a `tool_execution_failed` for the same failure.
 *     A reader that appends on each event counts one refusal twice — an
 *     earlier pass read leg r2 as 22 failures where the log holds 12. The
 *     stream is keyed by callId.
 *
 *  2. THE DENOMINATOR EXCLUDES FIRST EDITS. Both arms read before the
 *     first edit of a file — 95% and 100% — and always have. Folding
 *     those in drags every arm toward agreement and would hide the move
 *     this round is looking for. A leg whose every edit is a first edit
 *     has NO rate; it reports null, never 0%, because "never read back"
 *     and "never had the chance to" are different facts.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** The ordered tool stream of a leg: one row per CALL, not per event. */
export function callStream(legDir) {
	const dir = join(legDir, "kiso-home", "sessions");
	if (!existsSync(dir)) return [];
	const rows = [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.includes("trace"));
	for (const f of files) {
		const input = new Map();
		const seen = new Map();
		for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
			if (!line.trim()) continue;
			let rec;
			try { rec = JSON.parse(line); } catch { continue; }
			const e = rec?.event;
			if (!e) continue;
			if (e.type === "tool_call_end") input.set(e.callId, { name: e.name, input: e.input ?? {} });
			if (e.type !== "tool_result" && e.type !== "tool_execution_failed") continue;
			const c = input.get(e.callId);
			if (!c) continue;
			const ok = e.type === "tool_result" ? !e.isError : false;
			const prev = seen.get(e.callId);
			if (prev) { if (!ok) prev.ok = false; continue; }   // property 1
			const row = { seq: e.seq ?? 0, callId: e.callId, name: c.name, path: c.input.path ?? "", ok };
			seen.set(e.callId, row);
			rows.push(row);
		}
	}
	return rows.sort((a, b) => a.seq - b.seq);
}

/** The rate, from an ordered call stream. */
export function rateFromCalls(calls) {
	let firstEdits = 0, firstWithRead = 0, repeatEdits = 0, repeatWithRead = 0;
	const edited = new Set();
	for (let i = 0; i < calls.length; i++) {
		if (calls[i].name !== "edit_file") continue;
		const path = calls[i].path;
		let readFirst = false;
		for (let j = i - 1; j >= 0; j--) {
			if (calls[j].path !== path) continue;
			if (calls[j].name === "edit_file") break;          // the previous edit bounds the window
			if (calls[j].name === "read_file") { readFirst = true; break; }
		}
		if (edited.has(path)) { repeatEdits++; if (readFirst) repeatWithRead++; }
		else { firstEdits++; if (readFirst) firstWithRead++; edited.add(path); }
	}
	return {
		firstEdits, firstWithRead, repeatEdits, repeatWithRead,
		// property 2: no repeat edits means no rate, not a rate of zero
		rate: repeatEdits === 0 ? null : repeatWithRead / repeatEdits,
	};
}

export function readbackRate(legDir) { return rateFromCalls(callStream(legDir)); }

if (import.meta.url === `file://${process.argv[1]}`) {
	const legs = process.argv.slice(2);
	if (legs.length === 0) { console.error("usage: readback-rate.mjs <leg-dir> [leg-dir ...]"); process.exit(2); }
	let R = 0, RW = 0, F = 0, FW = 0;
	for (const leg of legs) {
		const r = readbackRate(leg);
		R += r.repeatEdits; RW += r.repeatWithRead; F += r.firstEdits; FW += r.firstWithRead;
		const pc = r.rate === null ? "  n/a" : `${(100 * r.rate).toFixed(1)}%`;
		console.log(`${leg.split("/").pop().padEnd(18)} first ${String(r.firstWithRead).padStart(3)}/${String(r.firstEdits).padEnd(4)} repeat ${String(r.repeatWithRead).padStart(3)}/${String(r.repeatEdits).padEnd(4)} rate ${pc}`);
	}
	console.log(`${"TOTAL".padEnd(18)} first ${String(FW).padStart(3)}/${String(F).padEnd(4)} repeat ${String(RW).padStart(3)}/${String(R).padEnd(4)} rate ${R ? `${(100 * RW / R).toFixed(1)}%` : "n/a"}`);
}
