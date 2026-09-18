/**
 * check-shape's rules, each made RED by a deliberately bad shape — so the
 * green on the real shape means the rule ran, not that it could not fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSeed, checkSeeds, checkShape } from "../check-shape.mjs";
import { generateAll } from "../generate.mjs";

const inst = (family, lines) => ({ family, required: lines.map((n) => ({ path: "x.js", lines: n })), estRequests: 5 });
/** a corpus-shaped spread of file lengths: 43% over 200, median ~158, p90 ~1,500 */
const REAL = [60, 90, 120, 150, 158, 170, 190, 250, 400, 900, 1500, 2000, 80, 110];
const set = (counts, lines = REAL) => Object.entries(counts).flatMap(([f, n]) => Array.from({ length: n }, () => inst(f, lines)));
const run = (counts, lines) => checkShape(["s"], () => set(counts, lines)).violations;

test("the real shape holds every rule over throwaway seeds", () => {
	const r = checkShape(checkSeeds(40));
	assert.deepEqual(r.violations, []);
	assert.equal(r.instancesPerArm, 30);
	assert.ok(r.requestsPerPassBothArms > 0, "the per-pass request estimate is printed for the gate");
});

test("red: a family above one third", () => {
	assert.ok(run({ A: 12, BD: 5, C: 5, E: 5, F: 5 }).some((v) => v.includes("family A") && v.includes("above one third")));
});

test("red: E and F below one third together", () => {
	assert.ok(run({ A: 8, BD: 8, C: 8, E: 5, F: 5 }).some((v) => v.includes("E + F")));
});

test("red: a family below the floor of five", () => {
	assert.ok(run({ A: 6, BD: 6, C: 4, E: 6, F: 6 }).some((v) => v.includes("family C") && v.includes("below the floor")));
});

test("red: files that never exceed the read window (the T6 fixture's world)", () => {
	const v = run({ A: 6, BD: 6, C: 6, E: 6, F: 6 }, [60, 60, 60]);
	assert.ok(v.some((x) => x.includes("exceed 200 lines")));
	assert.ok(v.some((x) => x.includes("median")));
});

test("red: files that always exceed it (wrong in the other direction)", () => {
	assert.ok(run({ A: 6, BD: 6, C: 6, E: 6, F: 6 }, [900, 1500, 3000]).some((x) => x.includes("exceed 200 lines")));
});

test("the rules are computed from GENERATED instances — a real draw's counts match", () => {
	const all = generateAll("throwaway-counts");
	const counts = {};
	for (const i of all) counts[i.family] = (counts[i.family] ?? 0) + 1;
	assert.deepEqual(counts, { A: 6, BD: 6, C: 6, E: 6, F: 6 });
});

test("one seed out of band is SAID out of band — the drawn seed is checked, not assumed (G6)", () => {
	const r = checkSeed("s", () => [...Array.from({ length: 30 }, (_, i) => inst(["A", "BD", "C", "E", "F"][i % 5], [900, 1500, 3000]))]);
	assert.equal(r.inBand, false);
	assert.equal(checkSeed("s", () => set({ A: 6, BD: 6, C: 6, E: 6, F: 6 })).inBand, true);
});

