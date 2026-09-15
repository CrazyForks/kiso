// T6 HELD-OUT BOUNDARY CHECKS — never copied into the workspace.
//
// Why held out: the fixture's own tests/ ship inside the tree the agent
// edits, so they are a specification it can read AND a bar it can move.
// These live outside fixture-t6/ and the `cp -R` that builds the leg never
// reaches them.
//
// THE RULE THAT KEEPS THIS HONEST: every assertion below cites the TURN
// that states it. A check that cannot cite a turn is a requirement the arm
// was never given, and grading against it measures my imagination instead
// of the product. Nothing here is new work — it is the work already asked
// for, evaluated at the inputs the fixture's tests happen to skip.
//
// The hole this closes was measured, not imagined: the cheapest leg of the
// paired round shipped countDistinct('') === 1 and longestRun('') === 1,
// where 0 is correct, and verify said pass.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const SRC = process.argv[2];
const url = (f) => pathToFileURL(resolve(SRC, f)).href;

const failed = [];
const passed = [];
// Each check is a thunk so one missing export cannot hide the rest: an arm
// that never wrote longestRun should still be told about parseRangeList.
const check = (name, turn, fn) => {
	try {
		fn();
		passed.push(name);
	} catch (e) {
		failed.push({ name, turn, detail: String(e && e.message ? e.message : e).split("\n")[0] });
	}
};
const eq = (actual, want, what) => {
	const a = JSON.stringify(actual);
	const w = JSON.stringify(want);
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
// Turn 5: "split text on commas, parse each part with parseRange, and SKIP
// parts that do not parse". ''.split(',') is [''], which does not parse —
// so the list is empty, and everything defined over it follows.
check("parseRangeList('')", 5, () => eq(R.parseRangeList(""), [], "parseRangeList('')"));
check("startsOf('')", 8, () => eq(R.startsOf(""), [], "startsOf('')"));
check("sumOf(startsOf(''))", 7, () => eq(R.sumOf(R.startsOf("")), 0, "sumOf of the empty list"));
check("countDistinct('')", 20, () => eq(R.countDistinct(""), 0, "countDistinct('')"));
check("longestRun('')", 21, () => eq(R.longestRun(""), 0, "longestRun('')"));
check("hasOverlap('')", 19, () => eq(R.hasOverlap(""), false, "hasOverlap('')"));
check("totalSpan('')", 11, () => eq(P.totalSpan(""), 0, "totalSpan('')"));
check("mergedText('')", 13, () => eq(P.mergedText(""), "", "mergedText('')"));

// ---- one range is not a pair ----------------------------------------
// Turn 19: "true when ANY TWO ranges overlap"; turn 23 counts pairs i < j.
// A single range forms no pair, and the arm that tests `overlaps` against
// the list rather than the pairs gets this wrong.
check("hasOverlap('1-2')", 19, () => eq(R.hasOverlap("1-2"), false, "one range is not an overlap"));

// ---- the bounds themselves -------------------------------------------
// Turn 1: "an inclusive clamp must return max". The fixture tests n ABOVE
// max; n AT max is the value the off-by-one actually sat on.
check("clamp at max", 1, () => eq(R.clamp(4, 1, 4), 4, "clamp(4,1,4)"));
check("clamp at min", 1, () => eq(R.clamp(1, 1, 4), 1, "clamp(1,1,4)"));
// Turn 2: "true when lo <= n <= hi" — the fixture tests hi, not lo.
check("isBetween at lo", 2, () => eq(R.isBetween(1, 1, 4), true, "isBetween(1,1,4)"));
// Turn 9: "share at least one integer" — containment shares all of them.
check("overlaps: containment", 9, () => eq(R.overlaps({ start: 1, end: 10 }, { start: 3, end: 4 }), true, "a contained range overlaps"));

// ---- distinct means distinct -----------------------------------------
// Turn 20 says DISTINCT integers. Summing spans gets 4 here.
check("countDistinct: duplicates", 20, () => eq(R.countDistinct("1-2,1-2"), 2, "countDistinct('1-2,1-2')"));

// ---- covered, not in the order given ---------------------------------
// Stated as a PROPERTY — same multiset, same answer — rather than as an
// absolute value, so a failure here means one thing only: the result
// depends on input order. Whether the sorted case itself is right is the
// fixture test's job, and it already asserts it. (Writing this as
// `longestRun("4-5,1-2,6-6") === 3` conflated the order property with
// "adjacent ranges continue a run", and my own reference implementation
// tripped the combined check without telling me which half it broke.)
check("longestRun: order-independent", 21, () =>
	eq(R.longestRun("4-5,1-2,6-6"), R.longestRun("1-2,4-5,6-6"), "longestRun must not depend on input order"));
// Turn 10: "sorted by start" is part of the OUTPUT contract, so unsorted
// input is inside it — parseRangeList preserves the order it was given.
check("mergeOverlaps: order-independent", 10, () =>
	eq(R.mergeOverlaps([{ start: 7, end: 8 }, { start: 2, end: 5 }, { start: 1, end: 3 }]),
		R.mergeOverlaps([{ start: 1, end: 3 }, { start: 2, end: 5 }, { start: 7, end: 8 }]),
		"mergeOverlaps must not depend on input order"));

// ---- the stated tie rule ---------------------------------------------
// Turn 12: "ties: the first". The fixture test deliberately uses a UNIQUE
// widest, so the rule it states has never been exercised.
check("widest: ties take the first", 12, () => eq(P.widest("1-2,3-4"), "1-2", "widest('1-2,3-4')"));

// ---- n = 1 keeps everything ------------------------------------------
// Turn 18: "indices 0, n, 2n, ...". With n = 1 that is every index.
check("everyNth(text, 1)", 18, () =>
	eq(R.everyNth("1-2,3-4", 1), [{ start: 1, end: 2 }, { start: 3, end: 4 }], "everyNth with n=1"));

console.log(JSON.stringify({ loaded: true, passed, failed }));
