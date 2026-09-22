#!/usr/bin/env node
/**
 * ADR-0055 Amendment 2 — the replay gate, local half. Projects real session
 * logs through the CURRENT projection and prints what a stacked session
 * recovers to. It READS the logs and writes nothing; its output is sizes
 * and seqs only — a checkpoint's text is the owner's work and is never
 * printed.
 *
 *   node scripts/replay-projection.mjs <session.jsonl> [...]
 *
 * "tiled" is the 0.40.1 projection of the same log: ADR-0044's ranges
 * tiled into the same covered union, so it equals the current projection
 * plus one message per superseded checkpoint. It is computed that way and
 * labeled so.
 *
 * Estimates are chars/4 over each message's JSON — the convention the
 * shrink invariant uses; the provider's bill differs (d7aa: −13%).
 */
import { readFileSync } from "node:fs";
import { projectMessages, SUMMARY_FRAMING } from "@vincemakes/kiso-core";

const estimate = (m) => Math.ceil(JSON.stringify(m).length / 4);
const isSummary = (m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith(SUMMARY_FRAMING);

const paths = process.argv.slice(2);
if (paths.length === 0) {
	console.error("usage: node scripts/replay-projection.mjs <session.jsonl> [...]");
	process.exit(2);
}
for (const path of paths) {
	const events = [];
	let lastBilledInput = null;
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (line === "") continue;
		const event = JSON.parse(line).event;
		events.push(event);
		if (event.type === "usage" && typeof event.inputTokens === "number") lastBilledInput = event.inputTokens;
	}
	const summaries = events.filter((e) => e.type === "summarized");
	const latest = summaries.reduce((a, e) => (a === undefined || e.coversToSeq >= a.coversToSeq ? e : a), undefined);
	const msgs = projectMessages(events);
	const now = msgs.reduce((n, m) => n + estimate(m), 0);
	const superseded = summaries
		.filter((e) => e !== latest)
		.reduce((n, e) => n + estimate({ role: "user", content: `${SUMMARY_FRAMING}\n\n${e.summary}` }), 0);
	const tiled = now + superseded;
	console.log(
		JSON.stringify({
			log: path.split("/").slice(-2).join("/"),
			summarizedEvents: summaries.length,
			latestCoversToSeq: latest?.coversToSeq ?? null,
			latestSummaryChars: latest?.summary.length ?? null,
			lastBilledInput,
			projected: { messages: msgs.length, summaryMessages: msgs.filter(isSummary).length, estimate: now },
			tiled040_1: { summaryMessages: summaries.length, estimate: tiled },
			drop: tiled === 0 ? "0%" : `${Math.round((1 - now / tiled) * 100)}%`,
		}),
	);
}
