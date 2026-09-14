#!/usr/bin/env node
/**
 * How close does REAL WORK come to the compaction threshold?
 *
 * Every threshold experiment so far has had to manufacture a session that
 * crosses 100,000 — the long-session bench task peaks near 10,000, and the
 * fixture that does cross it only does so because the task forbids the agent
 * from using search. Before tuning the number further it is worth asking
 * what the number does to sessions nobody staged.
 *
 * It measures the TRIGGER'S OWN QUANTITY: estimateTokens over
 * projectMessages(log), the same call the kernel makes, not the billed token
 * count and not the file size. A 5MB session log is mostly streaming deltas.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SessionStore } from "@vincemakes/kiso-runtime";
import { estimateTokens, projectMessages } from "@vincemakes/kiso-core";
import { isMain } from "../scripts/is-main.mjs";

export function survey(dir, { limit = null } = {}) {
	const store = new SessionStore(dir);
	const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.startsWith("sub-"));
	const ranked = files
		.map((f) => ({ f, size: statSync(join(dir, f)).size }))
		.sort((a, b) => b.size - a.size);
	const take = limit === null ? ranked : ranked.slice(0, limit);
	const rows = [];
	for (const { f, size } of take) {
		const id = f.slice(0, -6);
		let events;
		try { events = store.load(id).map((r) => r.event); } catch { continue; }
		const turns = events.filter((e) => e.type === "user_input").length;
		const boundaries = events.filter((e) => e.type === "microcompacted").length;
		let projected = 0;
		try { projected = estimateTokens(projectMessages(events)); } catch { continue; }
		rows.push({ id, sizeMB: +(size / 1e6).toFixed(1), turns, boundaries, projected });
	}
	return rows.sort((a, b) => b.projected - a.projected);
}

if (isMain(import.meta.url)) {
	const dir = process.argv[2];
	const limit = process.argv[3] ? Number.parseInt(process.argv[3], 10) : null;
	if (dir === undefined) { console.error("usage: survey-projected.mjs <sessions-dir> [limit]"); process.exit(2); }
	const rows = survey(dir, { limit });
	const THRESHOLD = 100_000;
	console.log(`sessions measured: ${rows.length}`);
	console.log(`peak projected tokens, highest first — the threshold in force was ${THRESHOLD.toLocaleString()}\n`);
	for (const r of rows.slice(0, 12))
		console.log(`  ${String(r.projected).padStart(7)} tok   ${String(r.turns).padStart(3)} turns   ${String(r.sizeMB).padStart(5)}MB   boundaries=${r.boundaries}   ${r.id}`);
	const over = rows.filter((r) => r.projected >= THRESHOLD).length;
	const half = rows.filter((r) => r.projected >= THRESHOLD / 2).length;
	console.log(`\n  at or above the threshold: ${over} of ${rows.length}`);
	console.log(`  at or above HALF of it:    ${half} of ${rows.length}`);
	console.log(`  highest observed:          ${rows[0]?.projected ?? 0} tokens = ${(100 * (rows[0]?.projected ?? 0) / THRESHOLD).toFixed(1)}% of the threshold`);
}
