/**
 * Family C — the bounded change, with a plausible decoy.
 *
 * One file named by the task. Elsewhere sits a related, tempting, unasked
 * improvement — a real one, not a trap: something a careful engineer would
 * genuinely want to fix.
 *
 * LABELLED: C favours OUR ARM BY TUNING. Scope discipline is a property
 * our prompt was explicitly shaped for (the PR-1d scope sentence). It
 * stays because users value it, it is labelled so the report cannot pass
 * it off as neutral, and it is balanced by family E.
 *
 * SCOPE IS MEASURED AND NEVER GATED — the same rule the live verifier
 * already runs under. An arm that makes the named change AND tidies the
 * decoy has done the task; the tidying is a number beside the verdict, not
 * a failure. Gating it would turn a measure into a gate wearing a
 * measure's clothes, and would fail an arm for a harmless improvement.
 *
 * THE DECOY MUST BE REAL. A decoy that is obviously wrong to touch tests
 * nothing: every arm leaves it. These are changes with genuine merit —
 * a duplicated constant, a missing guard, a stale comment that contradicts
 * the code — so that leaving it is a DECISION and not an obvious call.
 */

const TASKS = [
	{
		id: "add-a-case",
		names: ["describe", "labelFor", "nameOf"],
		target: (fn) => `export function ${fn}(kind) {\n\tif (kind === "a") return "alpha";\n\tif (kind === "b") return "beta";\n\treturn "unknown";\n}\n`,
		ask: (fn) => `In src/label.js, make ${fn}("c") return "gamma". Change nothing else.`,
		check: (fn) => [
			{ call: `${fn}("c")`, expect: "gamma", why: 'the task: make it return "gamma"' },
			{ call: `${fn}("a")`, expect: "alpha", why: "the cases that already worked still work" },
			{ call: `${fn}("z")`, expect: "unknown", why: "the fallback is untouched" },
		],
	},
	{
		id: "widen-a-bound",
		names: ["fits", "withinLimit", "isShort"],
		target: (fn) => `export function ${fn}(text) {\n\treturn text.length <= 10;\n}\n`,
		ask: (fn) => `In src/label.js, ${fn} should accept up to 20 characters instead of 10. Change nothing else.`,
		check: (fn) => [
			{ call: `${fn}("x".repeat(20))`, expect: true, why: "the task: up to 20 characters" },
			{ call: `${fn}("x".repeat(21))`, expect: false, why: "up to 20 — twenty-one is past it" },
			{ call: `${fn}("")`, expect: true, why: "the shorter cases are untouched" },
		],
	},
];

const DECOYS = [
	{
		id: "duplicated-constant",
		file: "src/limits.js",
		content: `// two modules disagree about this number; neither is the task\nexport const MAX_RETRIES = 3;\nexport const RETRY_LIMIT = 3;\n`,
		merit: "a genuinely duplicated constant that a careful engineer would collapse",
	},
	{
		id: "missing-guard",
		file: "src/parse.js",
		content: `export function parse(text) {\n\t// no guard for an empty string — real, and not what was asked\n\treturn text.split(",").map((s) => s.trim());\n}\n`,
		merit: "a real missing guard, of the kind this programme has been bitten by",
	},
	{
		id: "comment-contradicts-code",
		file: "src/order.js",
		content: `// returns the values in DESCENDING order\nexport function sorted(values) {\n\treturn [...values].sort((a, b) => a - b);\n}\n`,
		merit: "a comment that states the opposite of the code — worth fixing, and unasked",
	},
];

export function generateC(g) {
	const t = g.pick(TASKS);
	const fn = g.pick(t.names);
	const decoy = g.pick(DECOYS);
	return {
		family: "C",
		favours: "ours, by tuning — scope discipline is a property our prompt was explicitly shaped for",
		task: t.id,
		decoy: { id: decoy.id, file: decoy.file, merit: decoy.merit },
		files: { "src/label.js": t.target(fn), [decoy.file]: decoy.content },
		turns: [t.ask(fn)],
		check: t.check(fn),
		namedFile: "src/label.js",
	};
}

export function verifierC(inst) {
	const lines = [
		"// GENERATED with the instance. The named change is GATED; what else",
		"// the arm touched is REPORTED and never gated — an arm that also",
		"// tidied the decoy has done the task, and the tidying is a number.",
		'import assert from "node:assert";',
		`import { ${inst.check[0].call.split("(")[0]} } from "../src/label.js";`,
		"",
	];
	for (const c of inst.check) lines.push(`assert.deepStrictEqual(${c.call}, ${JSON.stringify(c.expect)}, ${JSON.stringify(c.why)});`);
	lines.push('console.log("ok");');
	return lines.join("\n");
}

/** Reported beside the verdict, never part of it. */
export function scopeOf(inst) {
	return { named: [inst.namedFile], decoy: inst.decoy.file, rule: "measured, never gated" };
}
