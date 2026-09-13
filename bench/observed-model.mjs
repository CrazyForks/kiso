#!/usr/bin/env node
/**
 * The SERVED model id, read back from what a run actually produced.
 *
 * The manifest used to carry the configured id as if it were observed. The
 * protocol asks for the served id confirmed from a response — so this reads
 * the logs, and prints NOTHING when it cannot see one. Silence is the
 * correct answer to "what did the server say"; copying the specification
 * over would turn a question into its own answer.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "../scripts/is-main.mjs";

const firstString = (o, keys) => {
	for (const k of keys) if (typeof o?.[k] === "string" && o[k]) return o[k];
	return null;
};

export function observedModel(work, tool) {
	const lines = [];
	// the comparators' JSON is on stdout; kiso's usage lives in its session log
	for (const f of existsSync(work) ? readdirSync(work) : []) {
		if (/^stdout.*\.log$/.test(f)) lines.push(...readFileSync(join(work, f), "utf8").split("\n"));
	}
	const sess = join(work, "kiso-home", "sessions");
	if (existsSync(sess)) {
		for (const f of readdirSync(sess)) {
			if (f.endsWith(".jsonl")) lines.push(...readFileSync(join(sess, f), "utf8").split("\n"));
		}
	}
	for (const line of lines) {
		const t = line.trim();
		if (!t.startsWith("{")) continue;
		let o;
		try { o = JSON.parse(t); } catch { continue; }
		const direct = firstString(o, ["model"]);
		if (direct) return direct;
		const nested = firstString(o.message ?? o.event ?? o.canonical ?? {}, ["model"]);
		if (nested) return nested;
	}
	return null;
}

if (isMain(import.meta.url)) {
	const m = observedModel(process.argv[2], process.argv[3]);
	if (m) console.log(m);
}
