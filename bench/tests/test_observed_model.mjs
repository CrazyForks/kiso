#!/usr/bin/env node
/**
 * TRACE-F1 — what counts as an OBSERVATION of the served model.
 *
 * The reconciliation in capture-config compares a specified id against an
 * observed one and reports whether they agree. That verdict is worth
 * nothing if the observed half is read from our own configuration: the
 * bench ran every leg against `deepseek-v4-flash` for four days while the
 * server served `deepseek-flash`, and the check said nothing because no
 * observation existed.
 *
 * What is tested here is the REFUSAL, in the same spirit as the manifest
 * tests one file over: silence is the correct answer to "what did the
 * server say" when the server said nothing. A confident wrong agreement is
 * worse than an admitted gap.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observedModel, observedModels, reconcileServedModel } from "../observed-model.mjs";
import { captureArm } from "../capture-config.mjs";

let n = 0;
const test = (name, fn) => {
	fn();
	n++;
	console.log(`  ok  ${name}`);
};

const legWith = (lines) => {
	const work = mkdtempSync(join(tmpdir(), "legwork-"));
	const traces = join(work, "kiso-home", "sessions", "traces");
	mkdirSync(traces, { recursive: true });
	writeFileSync(join(traces, "s1.jsonl"), lines.map((o) => JSON.stringify(o)).join("\n") + "\n");
	return work;
};

test("a kiso ledger naming only the REQUESTED id observes nothing", () => {
	// the pre-v6 world, and the exact shape that would manufacture agreement
	const work = legWith([{ kind: "request", model: "deepseek-v4-flash" }]);
	assert.equal(observedModel(work, "kiso"), null);
});

test("a kiso ledger carrying servedModel observes IT, not the request", () => {
	const work = legWith([{ kind: "request", model: "deepseek-v4-flash", servedModel: "deepseek-flash" }]);
	assert.equal(observedModel(work, "kiso"), "deepseek-flash");
});

test("a leg with no trace directory at all observes nothing", () => {
	const work = mkdtempSync(join(tmpdir(), "legwork-"));
	assert.equal(observedModel(work, "kiso"), null);
});

test("an empty servedModel is not a statement", () => {
	const work = legWith([{ kind: "request", model: "deepseek-v4-flash", servedModel: "" }]);
	assert.equal(observedModel(work, "kiso"), null);
});

test("a non-request line carrying servedModel is not read as one", () => {
	const work = legWith([{ kind: "header", servedModel: "wrong-source" }, { kind: "request", model: "m" }]);
	assert.equal(observedModel(work, "kiso"), null);
});


// ── TRACE-F1-R1 (Astra): one matching response never certifies a leg ──────
//
// The first observer returned on the FIRST request that named a model. A
// leg whose two responses named model-a and model-b reported "model-a",
// and the manifest certified whole-leg agreement against a configuration
// asking for model-a — suppressing the disagreement the observation exists
// to surface. A leg with one observation and one silent request read
// identically to a fully observed one.
//
// Astra's three fixtures, driven through the observer AND the manifest,
// because the defect only becomes visible where the verdict is formed.

const legWithServed = (served) =>
	legWith(served.map((m, i) => (m === null ? { kind: "request", model: "model-a" } : { kind: "request", model: "model-a", servedModel: m })));

const manifestModel = (served) =>
	captureArm({
		tool: "kiso",
		command: ["node", "--version"],
		model: "model-a",
		observed: { model: observedModels(legWithServed(served), "kiso") },
	}).model;

test("a leg served by TWO models does not agree — and keeps both", () => {
	const v = manifestModel(["model-a", "model-b"]);
	assert.equal(v.agrees, false, "the first response certified the whole leg");
	assert.deepEqual(v.observed, ["model-a", "model-b"]);
	assert.match(v.why, /2 different models/);
});

test("partial coverage is NOT agreement — it is unknown, with the count", () => {
	const v = manifestModel([null, "model-a"]);
	assert.equal(v.agrees, null, "requests nobody looked at cannot be certified");
	assert.equal(v.observedRequests, 1);
	assert.equal(v.requests, 2);
	assert.match(v.why, /1 of 2/);
});

test("the fully observed control DOES agree — and is distinguishable from the two above", () => {
	const v = manifestModel(["model-a", "model-a"]);
	assert.equal(v.agrees, true);
	assert.equal(v.observed, "model-a");
	assert.equal(v.observedRequests, 2);
	assert.equal(v.requests, 2);
});

test("a fully observed leg served something ELSE disagrees", () => {
	const v = manifestModel(["model-b", "model-b"]);
	assert.equal(v.agrees, false);
	assert.equal(v.observed, "model-b");
});

test("a leg nobody observed says so, and never agrees", () => {
	const v = manifestModel([null, null]);
	assert.equal(v.agrees, null);
	assert.equal(v.observed, null);
	assert.match(v.why, /not observed/);
});

test("the aggregate counts every request, observed or not", () => {
	const agg = observedModels(legWithServed(["model-a", null, "model-b"]), "kiso");
	assert.equal(agg.requests, 3);
	assert.equal(agg.observed, 2);
	assert.deepEqual(agg.ids, ["model-a", "model-b"]);
});

test("reconcileServedModel is pure — the same aggregate twice, the same verdict", () => {
	const agg = observedModels(legWithServed(["model-a", "model-b"]), "kiso");
	assert.deepEqual(reconcileServedModel("model-a", agg), reconcileServedModel("model-a", agg));
});

console.log(`[test_observed_model] ${n} assertions OK`);
