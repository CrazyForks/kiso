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
	// TRACE-F1: kiso's OWN observation is the trace sidecar's `servedModel`,
	// and nothing else. Its session log carries the model we ASKED for, so
	// reading a `model` field there and calling it observed would have this
	// file answer its own question — exactly what the note above forbids,
	// and what let a retired id reconcile as agreeing for four days.
	if (tool === "kiso") {
		const traces = join(work, "kiso-home", "sessions", "traces");
		for (const f of existsSync(traces) ? readdirSync(traces) : []) {
			if (!f.endsWith(".jsonl")) continue;
			for (const line of readFileSync(join(traces, f), "utf8").split("\n")) {
				const t = line.trim();
				if (!t.startsWith("{")) continue;
				let o;
				try { o = JSON.parse(t); } catch { continue; }
				if (o.kind === "request" && typeof o.servedModel === "string" && o.servedModel) return o.servedModel;
			}
		}
		// A ledger written before v6, or a provider that states nothing.
		// Silence, never the specification wearing the observation's name.
		return null;
	}

	// The comparators print their own result JSON on stdout, and the `model`
	// there IS the server's statement — a different file, a different claim.
	const lines = [];
	for (const f of existsSync(work) ? readdirSync(work) : []) {
		if (/^stdout.*\.log$/.test(f)) lines.push(...readFileSync(join(work, f), "utf8").split("\n"));
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
