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

/**
 * TRACE-F1-R1 (Astra): the SERVED ids across the WHOLE leg, with coverage.
 *
 * The first version returned on the first request that named one. A leg
 * whose two responses named model-a and model-b therefore reported
 * "model-a", and the manifest certified whole-leg agreement against a
 * configuration asking for model-a — suppressing the very disagreement
 * this observation exists to surface. A leg with one observation and one
 * silent request read identically to a fully observed one.
 *
 * So: every request is examined, the distinct ids are kept, and coverage
 * is counted. One matching response never certifies the requests nobody
 * looked at.
 */
export function observedModels(work, tool) {
	const ids = [];
	let requests = 0;
	let observed = 0;
	const note = (served) => {
		requests++;
		if (typeof served !== "string" || served === "") return;
		observed++;
		if (!ids.includes(served)) ids.push(served);
	};

	if (tool === "kiso") {
		// kiso's OWN observation is the trace sidecar's `servedModel`, and
		// nothing else. Its session log carries the id we ASKED for, so
		// reading a `model` field there would have this file answer its own
		// question — what let a retired id reconcile as agreeing for days.
		const traces = join(work, "kiso-home", "sessions", "traces");
		for (const f of existsSync(traces) ? readdirSync(traces) : []) {
			if (!f.endsWith(".jsonl")) continue;
			for (const line of readFileSync(join(traces, f), "utf8").split("\n")) {
				const t = line.trim();
				if (!t.startsWith("{")) continue;
				let o;
				try { o = JSON.parse(t); } catch { continue; }
				if (o.kind !== "request") continue;
				note(o.servedModel);
			}
		}
		return { ids, requests, observed };
	}

	// The comparators print their own result JSON on stdout, and the `model`
	// there IS the server's statement — a different file, a different claim.
	for (const f of existsSync(work) ? readdirSync(work) : []) {
		if (!/^stdout.*\.log$/.test(f)) continue;
		for (const line of readFileSync(join(work, f), "utf8").split("\n")) {
			const t = line.trim();
			if (!t.startsWith("{")) continue;
			let o;
			try { o = JSON.parse(t); } catch { continue; }
			const direct = firstString(o, ["model"]);
			const nested = direct ?? firstString(o.message ?? o.event ?? o.canonical ?? {}, ["model"]);
			if (nested === null && direct === null) continue;
			note(direct ?? nested);
		}
	}
	return { ids, requests, observed };
}

/**
 * The manifest's `model` verdict, from that aggregate.
 *
 * `agrees` is TRUE only when every request was observed and every one of
 * them named the specified id. Partial coverage is `null` with a reason,
 * never true: certifying requests nobody looked at is the same error as
 * reading a fallback as a measurement, one level up.
 */
export function reconcileServedModel(specified, agg) {
	const { ids, requests, observed } = agg;
	const out = { specified, observed: ids.length === 1 ? ids[0] : ids.length === 0 ? null : [...ids], agrees: null, requests, observedRequests: observed };
	if (ids.length === 0) {
		out.why = "not observed in this run";
		return out;
	}
	if (ids.length > 1) {
		out.agrees = false;
		out.why = `the leg was served by ${ids.length} different models — both are kept`;
		return out;
	}
	if (observed < requests) {
		out.why = `observed on ${observed} of ${requests} requests — the rest stated nothing`;
		return out;
	}
	out.agrees = ids[0] === specified;
	if (!out.agrees) out.why = "the run did not use what was specified — both are kept";
	return out;
}

/** The scalar form, kept for callers that only want the id. Null when the
 *  leg named none, and the FIRST id when it named several — a caller that
 *  needs the disagreement must read `observedModels`. */
export function observedModel(work, tool) {
	const { ids } = observedModels(work, tool);
	return ids.length === 0 ? null : ids[0];
}

if (isMain(import.meta.url)) {
	const m = observedModel(process.argv[2], process.argv[3]);
	if (m) console.log(m);
}
