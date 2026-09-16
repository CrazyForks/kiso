#!/usr/bin/env node
/**
 * The read-back rate instrument — the three properties it must hold.
 *
 * Each of these was a real defect in the throwaway version of this
 * measurement, not an imagined one, which is why they are pinned here
 * before the round that depends on the number.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callStream, rateFromCalls, readbackRate } from "../readback-rate.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

/** A leg whose durable log holds exactly these events. */
const legWith = (events) => {
	const work = mkdtempSync(join(tmpdir(), "readback-"));
	const dir = join(work, "kiso-home", "sessions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "s1.jsonl"),
		events.map((e, i) => JSON.stringify({ runId: "r", ts: i, event: { seq: i, ...e } })).join("\n") + "\n");
	return work;
};
const call = (callId, name, path) => ({ type: "tool_call_end", callId, name, input: { path } });
const okResult = (callId) => ({ type: "tool_result", callId, isError: false, content: "" });
const errResult = (callId) => ({ type: "tool_result", callId, isError: true, content: "" });
const failed = (callId) => ({ type: "tool_execution_failed", callId, error: "edit_file: pattern not found" });

test("a failed call emits BOTH events and is still ONE call", () => {
	// the defect: appending per event read leg r2 as 22 failures where the
	// log holds 12, and every rate computed from that stream was wrong.
	const leg = legWith([
		call("c1", "edit_file", "a.js"), errResult("c1"), failed("c1"),
	]);
	const s = callStream(leg);
	assert.equal(s.length, 1, "one call, two events");
	assert.equal(s[0].ok, false);
});

test("a leg with no repeat edit has NO rate — null, never 0%", () => {
	// "never read back" and "never had the chance to" are different facts,
	// and a 0% would average into a round as though it were the first.
	const leg = legWith([
		call("c1", "read_file", "a.js"), okResult("c1"),
		call("c2", "edit_file", "a.js"), okResult("c2"),
		call("c3", "edit_file", "b.js"), okResult("c3"),
	]);
	const r = readbackRate(leg);
	assert.equal(r.repeatEdits, 0);
	assert.equal(r.rate, null, "a rate of 0% would be a claim the leg cannot support");
	assert.equal(r.firstEdits, 2);
});

test("the read window is bounded by the PREVIOUS edit of that file", () => {
	// A read before the previous edit is not a read-back for this one: the
	// file has changed since. Without the bound every repeat edit after a
	// single early read counts as read-first, and the rate saturates.
	const leg = legWith([
		call("c1", "read_file", "a.js"), okResult("c1"),
		call("c2", "edit_file", "a.js"), okResult("c2"),   // first edit, read first
		call("c3", "edit_file", "a.js"), okResult("c3"),   // repeat, NOT read first
	]);
	const r = readbackRate(leg);
	assert.equal(r.firstEdits, 1);
	assert.equal(r.firstWithRead, 1);
	assert.equal(r.repeatEdits, 1);
	assert.equal(r.repeatWithRead, 0, "the earlier read was consumed by the first edit");
	assert.equal(r.rate, 0);
});

test("a genuine read-back counts", () => {
	const leg = legWith([
		call("c1", "read_file", "a.js"), okResult("c1"),
		call("c2", "edit_file", "a.js"), okResult("c2"),
		call("c3", "read_file", "a.js"), okResult("c3"),
		call("c4", "edit_file", "a.js"), okResult("c4"),
	]);
	const r = readbackRate(leg);
	assert.equal(r.repeatWithRead, 1);
	assert.equal(r.rate, 1);
});

test("a read of a DIFFERENT file is not a read-back", () => {
	const r = rateFromCalls([
		{ seq: 1, name: "edit_file", path: "a.js", ok: true },
		{ seq: 2, name: "read_file", path: "b.js", ok: true },
		{ seq: 3, name: "edit_file", path: "a.js", ok: true },
	]);
	assert.equal(r.repeatWithRead, 0);
});

console.log(`\n${n} tests passed`);
