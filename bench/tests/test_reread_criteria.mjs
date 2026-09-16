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
const kit = flat(readFileSync(join(B, "kits/reread-exemption.md"), "utf8"));
const js = readFileSync(join(B, "reread-verdict.mjs"), "utf8");

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

const BOTH = [
	["the primary bar", /median per-pair relative delta on the per-leg rate \| \*\*≤ −50%\*\*/, /RATE_DELTA_MAX = -0\.50\b/],
	["the bootstrap resamples", /20,000 resamples/, /BOOTSTRAP_N = 20000\b/],
	["the bootstrap seed", /seed `20260916`/, /BOOTSTRAP_SEED = "20260916"/],
	["the refusal share bar", /refused share of edit calls \*\*≤ 12%\*\*/, /REFUSED_SHARE_MAX = 0\.12\b/],
	["the cost bar", /median v2 delta \*\*≤ \+6%\*\*/, /COST_DELTA_MAX = 0\.06\b/],
	["n", /\| n \| \*\*22 pairs\*\* \|/, null],
];

for (const [name, inKit, inJs] of BOTH) {
	test(`the kit states ${name}`, () => assert.ok(inKit.test(kit), `the kit no longer states ${name}`));
	if (inJs) test(`the script states ${name}`, () => assert.ok(inJs.test(js), `the script no longer states ${name}`));
}

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

console.log(`\n${n} checks passed`);
