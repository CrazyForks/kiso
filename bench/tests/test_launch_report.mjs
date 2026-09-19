// launch-report.mjs — the kit's rules that must never slip: a VOID leg
// has no delta; UNKNOWN usage is never zero; an INCOMPLETE part has no
// comparative figure; the interval is reproducible from the kit's seed.
// Run: node bench/tests/test_launch_report.mjs
import assert from "node:assert/strict";
import { BOOTSTRAP, bootstrapMedianCI, median, summarize } from "../launch-report.mjs";

let n = 0;
const ok = (name, fn) => {
	fn();
	n += 1;
	console.log(`  ok   ${name}`);
};
const leg = (tool, run, costV2, extra = {}) => ({ tool, task: "T6", run, verify: "pass", void: false, unknownUsage: false, costV2, wall: 100, requests: 50, ...extra });

ok("the median of an even and an odd set", () => {
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([4, 1, 3, 2]), 2.5);
	assert.equal(median([]), null);
});

ok("pairs by (task, run); the delta is (kiso − reference) / reference", () => {
	const s = summarize([leg("kiso", "p1", 120), leg("pi", "p1", 100), leg("kiso", "p2", 90), leg("pi", "p2", 100)], { incomplete: false });
	assert.deepEqual(s.pairs.map((p) => p.dCost), [0.2, -0.1]);
	assert.equal(s.comparative.pairs, 2);
});

ok("a VOID leg is counted, excluded from its arm, and its pair has no delta", () => {
	const s = summarize([leg("kiso", "p1", 120, { void: true }), leg("pi", "p1", 100), leg("kiso", "p2", 90), leg("pi", "p2", 100)], { incomplete: false });
	assert.equal(s.arms.kiso.void, 1);
	assert.equal(s.arms.kiso.verifyOf, 1);
	assert.equal(s.comparative.pairs, 1);
});

ok("UNKNOWN usage is never zero: the leg stays, marked, and its pair has no cost delta", () => {
	const s = summarize([leg("kiso", "p1", null, { unknownUsage: true }), leg("pi", "p1", 100)], { incomplete: false });
	assert.equal(s.arms.kiso.unknownUsageLegs, 1);
	assert.equal(s.arms.kiso.medianCostV2, null);
	assert.equal(s.comparative.pairs, 1);
	assert.equal(s.comparative.costPairs, 0);
	assert.equal(s.comparative.medianDCost, null);
});

ok("an INCOMPLETE part reports its legs and NO comparative figure", () => {
	const s = summarize([leg("kiso", "p1", 120), leg("pi", "p1", 100)], { incomplete: true });
	assert.equal(s.comparative, null);
	assert.match(s.why, /INCOMPLETE/);
	assert.equal(s.arms.kiso.legs, 1);
});

ok("the bootstrap interval is reproducible from the kit's seed, and brackets the median", () => {
	const xs = [0.12, -0.05, 0.3, 0.08, 0.22, -0.01, 0.15, 0.4, 0.02, 0.1, 0.18, 0.07];
	const a = bootstrapMedianCI(xs, BOOTSTRAP);
	const b = bootstrapMedianCI(xs, BOOTSTRAP);
	assert.deepEqual(a, b);
	assert.ok(a[0] <= median(xs) && median(xs) <= a[1]);
	assert.equal(bootstrapMedianCI([0.1]), null); // one pair has no interval
});

console.log(`[launch-report] ${n} ok`);
