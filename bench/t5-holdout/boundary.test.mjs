// T5 HELD-OUT BOUNDARY CHECKS — never copied into the workspace.
//
// Same instrument as t6-holdout/, cut down to the seven turns T5 actually
// has. T5's turns 1-5 are word-for-word T6's turns 1-5, so the empty-input
// contract is identical: turn 5 says parseRangeList SKIPS parts that do not
// parse, and ''.split(',') is [''], a part that does not parse.
//
// The visible test already covers `summarize("x") === 0` — an unparseable
// part that is not empty. An implementation that special-cases non-numeric
// text and still reads '' as 0-0 passes that and fails this, which is the
// exact shape the T6 round found on its cheapest leg.
//
// THE RULE: every assertion cites the turn that states it.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const SRC = process.argv[2];
const url = (f) => pathToFileURL(resolve(SRC, f)).href;
const failed = [], passed = [];
const check = (name, turn, fn) => {
	try { fn(); passed.push(name); }
	catch (e) { failed.push({ name, turn, detail: String(e && e.message ? e.message : e).split("\n")[0] }); }
};
const eq = (actual, want, what) => {
	const a = JSON.stringify(actual), w = JSON.stringify(want);
	if (a !== w) throw new Error(`${what}: got ${a}, want ${w}`);
};

let R, P;
try {
	R = await import(url("range.js"));
	P = await import(url("report.js"));
} catch (e) {
	console.log(JSON.stringify({ loaded: false, error: String(e && e.message ? e.message : e).split("\n")[0], passed: [], failed: [] }));
	process.exit(0);
}

// ---- the empty input -------------------------------------------------
check("parseRangeList('')", 5, () => eq(R.parseRangeList(""), [], "parseRangeList('')"));
check("summarize('')", 6, () => eq(P.summarize(""), 0, "summarize('')"));

// ---- the bounds themselves -------------------------------------------
// Turn 1: "an inclusive clamp must return max". The visible test uses n
// ABOVE max; n AT max is where the off-by-one sat.
check("clamp at max", 1, () => eq(R.clamp(4, 1, 4), 4, "clamp(4,1,4)"));
check("clamp at min", 1, () => eq(R.clamp(1, 1, 4), 1, "clamp(1,1,4)"));
// Turn 2: "true when lo <= n <= hi" — the visible test exercises hi, not lo.
check("isBetween at lo", 2, () => eq(R.isBetween(1, 1, 4), true, "isBetween(1,1,4)"));
// Turn 4: "returns the string 'a-b' with a <= b" — a == b is that case.
check("formatRange(a, a)", 4, () => eq(R.formatRange(2, 2), "2-2", "formatRange(2,2)"));

console.log(JSON.stringify({ loaded: true, passed, failed }));
