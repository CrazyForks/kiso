#!/usr/bin/env node
/**
 * The frozen kit and the script that applies it must state the same
 * numbers.
 *
 * A margin transcribed by hand from a kit into a script can be retyped
 * later, and the retyping looks exactly like the original — so "frozen"
 * becomes a property of my intentions rather than of the repository.
 * This reads both files and compares them.
 *
 * The kit is PROSE: its sentences wrap, and inside a table a number sits
 * between pipes. Matching raw text found some and missed others in the
 * first version of the round-A equivalent, which then reported the script
 * as no longer defining constants that were sitting right there. Both
 * sides are whitespace-collapsed before matching.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const B = join(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (s) => s.split("\n").map((l) => l.replace(/^\s*>\s?/, "")).join(" ").replace(/\s+/g, " ");
const kit = flat(readFileSync(join(B, "kits/reread-replication.md"), "utf8"));
const js = readFileSync(join(B, "reread-replication-verdict.mjs"), "utf8");

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

const BOTH = [
	["the primary bar", /median paired relative delta \*\*≤ −30%\*\*/, /RATE_DELTA_MAX = -0\.30\b/],
	["the stale tolerance", /≤ 1\.0 pp over the round/, /STALE_TOLERANCE_PP = 1\.0\b/],
	["n", /\| n \| \*\*12 pairs\*\*, serial/, /PAIRS = Number\(process\.argv\[3\] \?\? 12\)/],
	["the bootstrap resamples", /20,000 resamples/, /BOOTSTRAP_N = 20000\b/],
	["the bootstrap seed", /seed `20260916`/, /BOOTSTRAP_SEED = "20260916"/],
	["the refusal share bar", /refused share of edit calls ≤ \*\*12%\*\*/, /REFUSED_SHARE_MAX = 0\.12\b/],
	["the cost bar", /median v2 delta ≤ \*\*\+6%\*\*/, /COST_DELTA_MAX = 0\.06\b/],
];

for (const [name, inKit, inJs] of BOTH) {
	test(`the kit states ${name}`, () => assert.ok(inKit.test(kit), `the kit no longer states ${name}`));
	if (inJs) test(`the script states ${name}`, () => assert.ok(inJs.test(js), `the script no longer states ${name}`));
}

test("the hazard guard is TWO-SIDED in both the kit and the script", () => {
	// version 1's fault: a guard that could only fire on arm-above-control
	// was structurally deaf to its own control exceeding its arm, which is
	// what that round's legs held. This must not come back.
	assert.ok(/SIZED and TWO-SIDED/i.test(kit), "the kit no longer says the hazard guard is two-sided");
	assert.ok(/absolute difference, not the signed one/i.test(kit), "the kit no longer explains WHY it is two-sided");
	assert.ok(/Math\.abs\(ppArm - ppCtl\)/.test(js), "the script no longer takes an ABSOLUTE difference");
	assert.ok(!/\(p\.arm\.ref\?\.stale \?\? 0\) > \(p\.ctl\.ref\?\.stale \?\? 0\)/.test(js),
		"the script has gone back to the one-sided arm>control test");
});

test("only a verify miss after a stale refusal BLOCKS; the gap is reported", () => {
	assert.ok(/verify miss after a stale-revision refusal BLOCKS/i.test(kit), "the kit no longer states rule 1");
	assert.ok(/never an auto-block/i.test(kit), "the kit no longer says an excess is a finding, not a block");
	assert.ok(/staleThenMiss/.test(js), "the script no longer separates the blocking case");
	assert.ok(/a finding for the lead, not a block/.test(js), "the script no longer labels an excess as a finding");
});

test("the arm is version 1's wording verbatim, and the control is the published prompt", () => {
	assert.ok(/rely on the earlier result and on the change you just made/.test(kit), "the kit no longer carries v1's exact arm text");
	assert.ok(/Control — the PUBLISHED prompt on `main`/.test(kit), "the kit no longer names the published prompt as control");
	assert.ok(!/cites the newest rev you hold/i.test(kit), "the WITHDRAWN version 2 wording has come back into the kit");
});

test("the kit demotes the sign rule and the script does not gate on it", () => {
	assert.ok(/sign rule is REPORTED, never a bar/i.test(kit), "the kit no longer demotes the sign rule");
	assert.ok(/REPORTED, not a bar/.test(js), "the script no longer labels the sign count as reported");
	assert.ok(!/negative.*(>=|>)\s*\d+.*verdict/i.test(js), "the script appears to gate on a negative-pair count");
});

test("the kit says the +6% bar is the ROUND'S choice, not BM-1's", () => {
	assert.ok(/THIS ROUND'S OWN CHOICE, stricter than BM-1/i.test(kit), "the kit no longer disclaims BM-1");
	assert.ok(/bm1-a1.*\+20%|\+20%.*bm1-a1/is.test(kit), "the kit no longer names bm1-a1's actual margin");
});

test("the kit and the script both refuse a void leg", () => {
	assert.ok(/no leg is excluded under any reading|VOID/i.test(kit), "the kit no longer states the void rule");
	assert.ok(/REFUSES ON A VOID LEG/.test(js), "the script no longer refuses a void leg");
});

test("the frozen empty-input class is the SAME eight in the kit and the script", () => {
	const CLASS = ["parseRangeList('')", "sumOf(startsOf(''))", "startsOf('')", "totalSpan('')",
		"mergedText('')", "hasOverlap('')", "countDistinct('')", "longestRun('')"];
	for (const c of CLASS) {
		assert.ok(kit.includes("`" + c + "`"), `the kit no longer names ${c} in the frozen class`);
		assert.ok(js.includes('"' + c + '"'), `the script no longer carries ${c} in EMPTY_INPUT_CLASS`);
	}
	// and the class is CLOSED: the script must not have grown past eight
	const m = js.match(/const EMPTY_INPUT_CLASS = \[([\s\S]*?)\];/);
	assert.ok(m, "EMPTY_INPUT_CLASS is gone");
	const listed = (m[1].match(/"/g) ?? []).length / 2;
	assert.equal(listed, 8, `the frozen class has ${listed} entries, not the eight the supersession closed`);
});

test("the supersession says who proposed it, and when", () => {
	assert.ok(/AFTER an inconvenient result/i.test(kit), "the kit no longer says the amendment came after a failure");
	assert.ok(/adjudicated by the lead, who is not rescued by it/i.test(kit), "the kit no longer names the adjudicator");
	assert.ok(/under one in ten/i.test(kit), "the kit no longer records the arithmetic that should have preceded the freeze");
});

test("a missed assertion OUTSIDE the class still blocks", () => {
	// functional, not textual: the guard must discriminate, or it is a
	// permission slip rather than a bar.
	const base = (x) => x.replace(/\s*\(turn \d+\)\s*$/, "").trim();
	const CLASS = ["parseRangeList('')", "startsOf('')", "longestRun('')"];
	const inside = ["parseRangeList('') (turn 5)", "longestRun('') (turn 21)"];
	const outside = ["parseRangeList('') (turn 5)", "clamp(5,1,4) (turn 1)"];
	assert.equal(inside.filter((m) => !CLASS.includes(base(m))).length, 0, "an all-inside leg must not block");
	assert.equal(outside.filter((m) => !CLASS.includes(base(m))).length, 1, "a leg with one outside miss MUST block");
});

console.log(`\n${n} checks passed`);
