/**
 * Family B+D — the defect the task does not name.
 *
 * The fixture ships with a planted defect. The task states a SYMPTOM and
 * never says a defect exists or where it is. `location` is a parameter:
 * in the file the task names, or in a dependency under it.
 *
 * LABELLED: neither arm's design is favoured. What it discriminates is
 * whether an arm follows a failure to its cause or works around it where
 * it surfaced.
 *
 * A SIMPLIFICATION TAKEN FROM WRITING IT. The design doc derived "guard
 * tests" by mutation, to tell a repair from a compensating change
 * elsewhere, and kept a byte comparison of the defective function's body
 * as a third assertion. Neither is needed: a test that calls the DEFECTIVE
 * FUNCTION DIRECTLY already separates the cases.
 *
 *   repaired at the defect       the direct test passes
 *   compensated at the caller    the function is still wrong, so the
 *                                direct test FAILS
 *   deleted and inlined          the named import fails — caught, and for
 *                                the right reason, because the function is
 *                                exported and the test imports it by name
 *
 * So the byte comparison is dropped, exactly as the doc's own fallback
 * allowed. A simpler assertion that decides the same question is not a
 * weaker one.
 */

const DEFECTS = [
	{
		id: "off-by-one-at-the-bound",
		names: ["clampTo", "boundValue", "holdWithin"],
		arity: 3,
		pristine: (f) => `export function ${f}(n, lo, hi) {\n\tif (n < lo) return lo;\n\tif (n > hi) return hi;\n\treturn n;\n}\n`,
		broken: (f) => `export function ${f}(n, lo, hi) {\n\tif (n < lo) return lo;\n\tif (n >= hi) return hi - 1;\n\treturn n;\n}\n`,
		direct: (f) => [
			{ call: `${f}(5, 1, 4)`, expect: 4, why: "at or past the upper bound the result is the bound" },
			{ call: `${f}(4, 1, 4)`, expect: 4, why: "the upper bound itself is a legal value" },
		],
	},
	{
		id: "wrong-comparison",
		names: ["keepNonNegative", "positives", "atLeastZero"],
		arity: 1,
		pristine: (f) => `export function ${f}(values) {\n\treturn values.filter((v) => v >= 0);\n}\n`,
		broken: (f) => `export function ${f}(values) {\n\treturn values.filter((v) => v > 0);\n}\n`,
		direct: (f) => [
			{ call: `${f}([-1, 0, 2])`, expect: [0, 2], why: "zero is not negative and is kept" },
		],
	},
	{
		id: "swapped-arguments",
		names: ["ordered", "asPair", "smallerFirst"],
		arity: 2,
		pristine: (f) => `export function ${f}(a, b) {\n\treturn a <= b ? [a, b] : [b, a];\n}\n`,
		broken: (f) => `export function ${f}(a, b) {\n\treturn a <= b ? [b, a] : [a, b];\n}\n`,
		direct: (f) => [
			{ call: `${f}(1, 9)`, expect: [1, 9], why: "the smaller value comes first" },
			{ call: `${f}(9, 1)`, expect: [1, 9], why: "the smaller value comes first, whichever way they arrive" },
		],
	},
];

export function generateBD(g, { shape } = {}) {
	const d = shape === undefined ? g.pick(DEFECTS) : DEFECTS[shape % DEFECTS.length];
	// EACH DEFECT CARRIES ITS OWN NAMES. Drawing from one pool produced
	// `ordered([-1, 0, 2])` for a filter and `clampTo(...)` for a pair
	// swap — the same defect I had already fixed in family A and then
	// reproduced here. A misleading name makes the task harder for a reason
	// that has nothing to do with the property under test.
	const fn = g.pick(d.names);
	const location = g.pick(["named", "dependency"]);
	const defectFile = location === "named" ? "src/core.js" : "src/util.js";
	const files = {
		"src/util.js": location === "dependency" ? d.broken(fn) : `export const VERSION = "1";\n`,
		// THE SCAFFOLD MUST MATCH THE DEFECT'S SIGNATURE. The first version
		// wrote one caller that passed (v, lo, hi) to every defect, so two of
		// the three produced a core.js that was broken CODE rather than a
		// workspace with one planted defect — the instance would have been
		// measuring the generator.
		"src/core.js": location === "named"
			? d.broken(fn)
			: `import { ${fn} } from "./util.js";\n${
				d.arity === 3 ? `export function apply(values, lo, hi) {\n\treturn values.map((v) => ${fn}(v, lo, hi));\n}` :
				d.arity === 2 ? `export function apply(a, b) {\n\treturn ${fn}(a, b);\n}` :
				`export function apply(values) {\n\treturn ${fn}(values);\n}`
			}\nexport { ${fn} };\n`,
	};
	// THE SYMPTOM, never the location and never the word "bug"
	const sym = d.direct(fn)[0];
	return {
		family: "B+D",
		favours: "neither",
		defect: { id: d.id, fn, file: defectFile, location },
		files,
		turns: [`In this workspace, ${sym.call} returns the wrong value — it should be ${JSON.stringify(sym.expect)}. Make it correct.`],
		direct: d.direct(fn),
		importFrom: location === "named" ? "../src/core.js" : "../src/util.js",
	};
}

export function verifierBD(inst) {
	const lines = [
		"// GENERATED with the instance. Every assertion calls the DEFECTIVE",
		"// FUNCTION DIRECTLY, which is what separates a repair at the defect",
		"// from a compensating change at a caller: a compensation leaves the",
		"// function wrong and these fail.",
		'import assert from "node:assert";',
		`import { ${inst.defect.fn} } from ${JSON.stringify(inst.importFrom)};`,
		"",
	];
	for (const c of inst.direct) {
		lines.push(`assert.deepStrictEqual(${c.call}, ${JSON.stringify(c.expect)}, ${JSON.stringify(c.why)});`);
	}
	lines.push('console.log("ok");');
	return lines.join("\n");
}

/** How many shapes this family has — the builder's quota needs it. */
export const SHAPE_COUNT = DEFECTS.length;
