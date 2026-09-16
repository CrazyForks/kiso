/**
 * Family A — progressive API construction.
 *
 * N turns, each adding one exported function; the final contract exercised
 * together. Labelled in the design as favouring OUR arm BY HISTORY: it is
 * the shape of every task this programme has run, and it carries no more
 * than a third of the instances.
 *
 * THE RULE THAT MAKES A GENERATED VERIFIER FAIR: every assertion carries
 * the sentence that requires it. A contract here is one object holding
 * BOTH the turn's text and its cases, so the two cannot drift — a verifier
 * written separately, or afterwards, is a verifier tuned to what the arms
 * did.
 *
 * Boundary cases are part of the contract, not an extra: the empty input,
 * the value AT a stated bound, a stated tie rule, order-independence where
 * the contract says "covered". Each is derivable from the sentence beside
 * it, which is what stops the held-out checks from grading the author's
 * imagination.
 */

/** The contract pool. Each entry is a FUNCTION of the drawn parameters, so
 *  instances differ in name, shape and data while the derivation stays the
 *  same. `cite` is the sentence; `cases` may only assert what it states. */
// EACH CONTRACT CARRIES ITS OWN NAMES. Drawing names from one pool made
// instances like `between(values)` for a SUM and `uniques(n, lo, hi)` for a
// range check — misleading names that make a task harder for a reason that
// has nothing to do with the property under test, and harder by an unknown
// and different amount for each arm. A generator that produces those is
// measuring name confusion.
const CONTRACTS = [
	{ names: ["between", "within", "inRange"], make: ({ fn, lo, hi }) => ({
		name: fn,
		sentence: `Add ${fn}(n, lo, hi) to src/span.js and export it: true when lo <= n <= hi.`,
		cases: [
			{ call: `${fn}(${lo}, ${lo}, ${hi})`, expect: true, cite: "true when lo <= n" },
			{ call: `${fn}(${hi}, ${lo}, ${hi})`, expect: true, cite: "true when n <= hi" },
			{ call: `${fn}(${hi + 1}, ${lo}, ${hi})`, expect: false, cite: "false past hi" },
		],
	}) },
	{ names: ["total", "sumOf", "tally"], make: ({ fn }) => ({
		name: fn,
		sentence: `Add ${fn}(values) to src/span.js and export it: the sum of an array of numbers, and 0 when the array is empty.`,
		cases: [
			{ call: `${fn}([1, 2, 3])`, expect: 6, cite: "the sum of an array of numbers" },
			{ call: `${fn}([])`, expect: 0, cite: "0 when the array is empty" },
		],
	}) },
	{ names: ["pieces", "partsOf", "splitParts"], make: ({ fn, sep }) => ({
		name: fn,
		sentence: `Add ${fn}(text) to src/span.js and export it: split text on "${sep}" and return the parts that are non-empty after trimming, in order.`,
		cases: [
			{ call: `${fn}(${JSON.stringify(`a${sep} b ${sep}c`)})`, expect: ["a", "b", "c"], cite: "non-empty after trimming, in order" },
			{ call: `${fn}("")`, expect: [], cite: "the parts that are NON-EMPTY — an empty text has none" },
			{ call: `${fn}(${JSON.stringify(`${sep}${sep}`)})`, expect: [], cite: "the parts that are NON-EMPTY" },
		],
	}) },
	{ names: ["uniques", "distinctCount", "howManyDistinct"], make: ({ fn }) => ({
		name: fn,
		sentence: `Add ${fn}(values) to src/span.js and export it: the number of DISTINCT values, counting each repeated value once.`,
		cases: [
			{ call: `${fn}([1, 2, 2, 3])`, expect: 3, cite: "counting each repeated value once" },
			{ call: `${fn}([])`, expect: 0, cite: "the number of distinct values — of none, none" },
			{ call: `${fn}([7, 7, 7])`, expect: 1, cite: "counting each repeated value once" },
		],
	}) },
	{ names: ["streak", "longestRun", "runLength"], make: ({ fn }) => ({
		name: fn,
		sentence: `Add ${fn}(values) to src/span.js and export it: the length of the longest run of CONSECUTIVE integers present, in any order.`,
		cases: [
			{ call: `${fn}([1, 2, 3, 9])`, expect: 3, cite: "the longest run of consecutive integers" },
			{ call: `${fn}([3, 1, 2])`, expect: 3, cite: "present, IN ANY ORDER" },
			{ call: `${fn}([])`, expect: 0, cite: "the longest run present — of none, none" },
		],
	}) },
	{ names: ["joinPair", "pairText", "formatPair"], make: ({ fn, pad }) => ({
		name: fn,
		sentence: `Add ${fn}(a, b) to src/span.js and export it: the string "a${pad}b" with the smaller value first.`,
		cases: [
			{ call: `${fn}(1, 3)`, expect: `1${pad}3`, cite: `the string "a${pad}b"` },
			{ call: `${fn}(3, 1)`, expect: `1${pad}3`, cite: "with the smaller value first" },
			{ call: `${fn}(2, 2)`, expect: `2${pad}2`, cite: "the smaller value first — equal values are already in order" },
		],
	}) },
];

export function generateA(g, { turns = 8 } = {}) {
	const picked = g.sample(CONTRACTS, Math.min(turns, CONTRACTS.length));
	const sep = g.pick([",", ";", "|"]);
	const pad = g.pick(["-", "..", ":"]);
	const lo = 1 + g.int(5);
	const contracts = picked.map((c) => c.make({ fn: g.pick(c.names), sep, pad, lo, hi: lo + 3 + g.int(6) }));
	return {
		family: "A",
		favours: "ours, by history — this is the shape of every task this programme has run",
		turns: contracts.map((c, i) => `${i + 1}. ${c.sentence}`),
		contracts,
	};
}

/** The verifier, emitted from the SAME contracts the turns came from. */
export function verifierA(inst) {
	const lines = [
		"// GENERATED with the instance — never written by hand, never after the run.",
		"// Every assertion names the sentence that requires it: a check that cannot",
		"// cite the task text is a requirement the arm was never given.",
		'import assert from "node:assert";',
		`import { ${inst.contracts.map((c) => c.name).join(", ")} } from "../src/span.js";`,
		"",
	];
	for (const c of inst.contracts) {
		lines.push(`// ${c.sentence}`);
		for (const k of c.cases) {
			lines.push(`assert.deepStrictEqual(${k.call}, ${JSON.stringify(k.expect)}, ${JSON.stringify(`${c.name}: ${k.cite}`)});`);
		}
		lines.push("");
	}
	lines.push('console.log("ok");');
	return lines.join("\n");
}
