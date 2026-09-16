#!/usr/bin/env node
/**
 * WHERE THE CITED REVISION CAME FROM — version 2's diagnostic.
 *
 * The v2 bullet tells the model that a successful edit returns the file's
 * new [rev:…] and that its next edit to that file cites the newest rev it
 * holds. Whether the model DID that is not the primary metric and gates
 * nothing; it is how we learn whether a null result means the sentence
 * does not work or that it was never followed.
 *
 * For every REPEAT edit — the population the primary measures — the cited
 * expectedRevision is matched against the two revisions the leg had in
 * hand for that file at that moment:
 *   receipt — the rev returned by the last successful edit of it
 *   read    — the rev on the last successful read of it
 *   neither — it cited something else, or cited nothing
 *
 * "Both" is possible and is counted apart: right after a read of a file
 * nothing has edited since, the two revisions are the same string, and
 * reporting that as "receipt" would invent evidence the leg does not hold.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const REV = /\[rev:([0-9a-f]+)\]/;

/** Ordered successful/failed tool rows with the text each carried. */
export function rows(legDir) {
	const dir = join(legDir, "kiso-home", "sessions");
	if (!existsSync(dir)) return [];
	const f = readdirSync(dir).find((x) => x.endsWith(".jsonl") && !x.includes("trace"));
	if (!f) return [];
	const input = new Map(); const seen = new Map(); const out = [];
	for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
		if (!line.trim()) continue;
		let r; try { r = JSON.parse(line); } catch { continue; }
		const e = r?.event; if (!e) continue;
		if (e.type === "tool_call_end") input.set(e.callId, { name: e.name, input: e.input ?? {} });
		if (e.type !== "tool_result" && e.type !== "tool_execution_failed") continue;
		const c = input.get(e.callId); if (!c) continue;
		const ok = e.type === "tool_result" ? !e.isError : false;
		const text = e.type === "tool_result" ? String(e.content ?? "") : String(e.error ?? "");
		const prev = seen.get(e.callId);
		if (prev) { if (!ok) { prev.ok = false; if (!prev.text) prev.text = text; } continue; }
		const row = { seq: e.seq ?? 0, name: c.name, input: c.input, path: c.input.path ?? "", ok, text };
		seen.set(e.callId, row); out.push(row);
	}
	return out.sort((a, b) => a.seq - b.seq);
}

export function revSourceFromRows(all) {
	const lastReceipt = new Map(), lastRead = new Map(), edited = new Set();
	const tally = { receipt: 0, read: 0, both: 0, neither: 0, noRevCited: 0, repeatEdits: 0 };
	for (const r of all) {
		if (r.name === "read_file" && r.ok) { const m = REV.exec(r.text); if (m) lastRead.set(r.path, m[1]); }
		if (r.name !== "edit_file") continue;
		if (edited.has(r.path)) {
			tally.repeatEdits += 1;
			const cited = r.input.expectedRevision;
			const rc = lastReceipt.get(r.path), rd = lastRead.get(r.path);
			if (!cited) tally.noRevCited += 1;
			else if (rc && rd && cited === rc && cited === rd) tally.both += 1;
			else if (rc && cited === rc) tally.receipt += 1;
			else if (rd && cited === rd) tally.read += 1;
			else tally.neither += 1;
		}
		edited.add(r.path);
		if (r.ok) { const m = REV.exec(r.text); if (m) lastReceipt.set(r.path, m[1]); }
	}
	return tally;
}

export const revSource = (legDir) => revSourceFromRows(rows(legDir));

if (import.meta.url === `file://${process.argv[1]}`) {
	const legs = process.argv.slice(2);
	if (!legs.length) { console.error("usage: reread-rev-source.mjs <leg-dir> ..."); process.exit(2); }
	const T = { receipt: 0, read: 0, both: 0, neither: 0, noRevCited: 0, repeatEdits: 0 };
	for (const leg of legs) {
		const t = revSource(leg);
		for (const k of Object.keys(T)) T[k] += t[k];
		console.log(`${leg.split("/").pop().padEnd(16)} repeat ${String(t.repeatEdits).padStart(3)}  receipt ${String(t.receipt).padStart(3)}  read ${String(t.read).padStart(3)}  both ${String(t.both).padStart(3)}  neither ${String(t.neither).padStart(3)}  none ${t.noRevCited}`);
	}
	console.log(`${"TOTAL".padEnd(16)} repeat ${String(T.repeatEdits).padStart(3)}  receipt ${String(T.receipt).padStart(3)}  read ${String(T.read).padStart(3)}  both ${String(T.both).padStart(3)}  neither ${String(T.neither).padStart(3)}  none ${T.noRevCited}`);
}
