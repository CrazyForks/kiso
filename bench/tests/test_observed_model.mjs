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
import { observedModel } from "../observed-model.mjs";

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

console.log(`[test_observed_model] ${n} assertions OK`);
