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
import { isReferenceCompletion } from "./requests-so-far.mjs";

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

	// TRACE-F1-R3 (Astra): a record WITHOUT a model used to be skipped
	// before `note` ran — and `note` is what counts a request. Two records
	// with one model between them reported `1 of 1, agrees: true`: missing
	// evidence had become complete coverage, which is the same manufactured
	// agreement this whole observer exists to prevent, arriving through the
	// denominator instead of the numerator.
	//
	// So the boundary is identified FIRST, by the shared predicate, and the
	// model is read after.
	if (tool === "pi") {
		for (const f of existsSync(work) ? readdirSync(work) : []) {
			if (!/^stdout.*\.log$/.test(f)) continue;
			for (const line of readFileSync(join(work, f), "utf8").split("\n")) {
				const t = line.trim();
				if (!t.startsWith("{")) continue;
				let o;
				try { o = JSON.parse(t); } catch { continue; }
				if (!isReferenceCompletion(o)) continue;
				note(firstString(o, ["model"]) ?? firstString(o.message ?? {}, ["model"]));
			}
		}
		return { ids, requests, observed };
	}

	// Claude Code prints ONE result object per invocation carrying
	// `num_turns` — the requests it covers are summed, never enumerated. So
	// per-request coverage cannot be established from this log at all, and
	// saying so is the honest answer. `requests: null` means "this arm's
	// native record cannot tell us", which the verdict below refuses to read
	// as completeness. The ids it DOES name are still collected: a mismatch
	// is knowable even when coverage is not.
	for (const f of existsSync(work) ? readdirSync(work) : []) {
		if (!/^stdout.*\.log$/.test(f)) continue;
		for (const line of readFileSync(join(work, f), "utf8").split("\n")) {
			const t = line.trim();
			const i = t.indexOf("{");
			if (i < 0) continue;
			let o;
			try { o = JSON.parse(t.slice(i)); } catch { continue; }
			// the id appears as a VALUE on the warning line and as a KEY in
			// modelUsage; both are the server's statement about this leg
			const direct = firstString(o, ["model"]);
			if (direct !== null && !ids.includes(direct)) ids.push(direct);
			const mu = o.modelUsage;
			if (mu !== null && typeof mu === "object") {
				for (const k of Object.keys(mu)) if (k !== "" && !ids.includes(k)) ids.push(k);
			}
		}
	}
	return { ids, requests: null, observed: null };
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
	const complete = requests !== null && observed !== null && observed >= requests;
	const out = {
		specified,
		observed: ids.length === 1 ? ids[0] : ids.length === 0 ? null : [...ids],
		agrees: null,
		requests,
		observedRequests: observed,
	};
	if (ids.length === 0) {
		out.why = requests === null ? "this arm's native record cannot establish per-request coverage" : "not observed in this run";
		return out;
	}
	// TRACE-F1-R2 (Astra): A MISMATCH OUTRANKS INCOMPLETE COVERAGE. Asking
	// for A and observing [B, absent] used to return `null`, because the
	// coverage branch came first — but B has already disproved agreement
	// with A, and reporting a known disagreement as unknown is the same
	// error as reporting an unknown as agreement, pointed the other way.
	// Only when everything observed AGREES is missing coverage the reason
	// we cannot conclude.
	const wrong = ids.filter((id) => id !== specified);
	if (wrong.length > 0) {
		out.agrees = false;
		out.why =
			ids.length > 1
				? `the leg was served by ${ids.length} different models — all are kept`
				: "the run did not use what was specified — both are kept";
		return out;
	}
	if (!complete) {
		out.why =
			requests === null
				? "every observation agrees, but this arm's native record cannot establish per-request coverage"
				: `every observation agrees, but only ${observed} of ${requests} requests were observed`;
		return out;
	}
	out.agrees = true;
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
