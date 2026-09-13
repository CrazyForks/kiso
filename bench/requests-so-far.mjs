#!/usr/bin/env node
/**
 * How many REQUESTS a leg has made so far — by the extractor's definition.
 *
 * The first version grepped for lines containing `"usage"`. pi carries a
 * usage block on nearly every event line, so a healthy leg four requests in
 * counted as 551 and the hard cap stopped it. The cap mechanism was right;
 * the rule it applied was not, and a leg recorded as "hit the request
 * ceiling" would have been a false finding about a product.
 *
 * So the ceiling and the ledger share one definition. If they disagree, the
 * cap is measuring something the budget is not made of.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "../scripts/is-main.mjs";

const linesOf = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n") : []);

export function requestsSoFar(work, tool) {
	let n = 0;
	if (tool === "kiso") {
		// The extractor PREFERS the trace sidecar when a session has one and
		// falls back to the session log otherwise — so this does the same,
		// rather than summing both (double counting) or reading only the log
		// (which was 39 against the ledger's 40: the sidecar carried one
		// record the log did not, and the ceiling must count what the budget
		// counts).
		const sess = join(work, "kiso-home", "sessions");
		if (!existsSync(sess)) return 0;
		const traces = join(sess, "traces");
		const tracedIds = new Set();
		if (existsSync(traces)) {
			for (const f of readdirSync(traces)) {
				if (!f.endsWith(".jsonl")) continue;
				tracedIds.add(f);
				for (const line of linesOf(join(traces, f))) {
					const t = line.trim();
					if (!t.startsWith("{")) continue;
					let o;
					try { o = JSON.parse(t); } catch { continue; }
					if (o?.canonical || o?.kind === "request") n++;
				}
			}
		}
		for (const f of readdirSync(sess)) {
			if (!f.endsWith(".jsonl") || tracedIds.has(f)) continue;   // traced sessions are counted above
			for (const line of linesOf(join(sess, f))) {
				const t = line.trim();
				if (!t.startsWith("{")) continue;
				let o;
				try { o = JSON.parse(t); } catch { continue; }
				if (o?.event?.type === "usage") n++;
			}
		}
		return n;
	}
	// PER ARM, never a shared "has a usage block" heuristic. pi emits a
	// STREAMING `message_update` carrying a top-level usage object — 538 of
	// them for four requests in this leg — and a cross-arm rule counted every
	// one. An increment of one request is a decision about THAT arm's
	// protocol, so each arm states its own.
	for (const f of existsSync(work) ? readdirSync(work) : []) {
		if (!/^stdout.*\.log$/.test(f)) continue;
		for (const line of linesOf(join(work, f))) {
			const t = line.trim();
			if (!t.startsWith("{")) continue;
			let o;
			try { o = JSON.parse(t); } catch { continue; }
			if (tool === "pi") {
				// the extractor's own rule: the FINAL per-request usage
				if (o?.type !== "message_end") continue;
				const u = o?.message?.usage;
				if (u && typeof u === "object" && "input" in u) n++;
			} else {
				// Claude Code prints one result object per invocation and
				// reports how many turns it took inside it.
				//
				// Identified by what it CARRIES, not by what it lacks: the
				// first version skipped anything with a `type` key on the
				// assumption that the result object had none. It has one, so
				// the counter returned 0 while the ledger read 70 — a ceiling
				// that could never fire on this arm. The shape was guessed
				// rather than read.
				if (!o?.usage || typeof o.usage !== "object") continue;
				if (o.num_turns === undefined) continue;
				n += Number(o.num_turns) || 1;
			}
		}
	}
	return n;
}

if (isMain(import.meta.url)) console.log(requestsSoFar(process.argv[2], process.argv[3]));
