/**
 * The five families (the review's rulings 1–5) — each a pure function
 * (rng, index) → instance DATA. Nothing here touches the filesystem;
 * materialize.mjs writes what these return, verify.mjs reads it back.
 *
 * An instance:
 *   { family, favours, params, files, tasks, spec, required, estRequests, kill? }
 *     files     — path → text, the fixture the agent works in
 *     tasks     — the turn prompts, the array shape the T5/T6 runners read
 *     spec      — the verifier: { gates: [...], reports: [...] }, every gate
 *                 carrying `cite: { turn, clause }` with `clause` a verbatim
 *                 substring of tasks[turn - 1] (the citation rule, checked
 *                 at generation time)
 *     required  — [{ path, lines }]: the files the task needs READ — what
 *                 check-shape's truncation share is computed over
 */

import { CONTRACTS, drawContract } from "./contracts.mjs";
import { buildModule } from "./base.mjs";
import { drawLength } from "./prng.mjs";

/** Ruling 1's labels, verbatim — carried into every instance.json. */
export const FAVOURS = {
	A: "ours by history",
	BD: "neither",
	C: "ours by tuning",
	E: "theirs by design",
	F: "ours by design",
};

/** Ruling 2 and the launch plan: 6 instances per family per arm. */
export const PER_FAMILY = { A: 6, BD: 6, C: 6, E: 6, F: 6 };

const PACKAGE_JSON = `${JSON.stringify({ name: "bench-fixture", private: true, type: "module" })}\n`;

const MODULE_BY_KIND = {
	ordering: ["src/order.js", "src/ranking.js", "src/stats.js"],
	set: ["src/sets.js", "src/collections.js", "src/groups.js"],
	interval: ["src/spans.js", "src/ranges.js", "src/intervals.js"],
	string: ["src/text.js", "src/strings.js", "src/words.js"],
};

/** Evaluate a function's source on args (the generator's oracle). */
function run(impl, name, args) {
	// eslint-disable-next-line no-new-func
	const fn = new Function(`${impl}\nreturn ${name};`)();
	return fn(...structuredClone(args));
}

function citeCheck(tasks, cite) {
	if (!tasks[cite.turn - 1]?.includes(cite.clause)) throw new Error(`citation not in turn ${cite.turn}: ${cite.clause}`);
	return cite;
}

/** The contract's checks as verifier gates, expected values from the reference. */
function contractGates(c, module, turn, tasks, idPrefix) {
	return c.checks.map((k, i) => ({
		type: "call",
		id: `${idPrefix}${c.name}#${i + 1}`,
		module,
		fn: c.name,
		args: k.args,
		expect: run(c.impl, c.name, k.args),
		gate: true,
		cite: citeCheck(tasks, { turn, clause: k.clause }),
	}));
}

/** A module file of drawn length that already holds `inserts`. */
function longModule(rng, path, inserts = []) {
	const lines = drawLength(rng);
	const m = buildModule(rng, { lines, title: path, inserts });
	return { path, text: m.text, lines: m.lines, starts: m.starts };
}

// ── A — progressive API construction ─────────────────────────────────────

/** Shared by A and F (F is an A instance plus a kill point and a ledger). */
function progressive(rng, { ledger }) {
	const turns = rng.int(6, 10);
	const taken = new Set();
	const templates = rng.sample(CONTRACTS, turns);
	const modules = new Map(); // path → module
	const files = { "package.json": PACKAGE_JSON };
	const tasks = [];
	const gates = [];
	const contracts = [];
	templates.forEach((t, i) => {
		const c = drawContract(rng, t, taken);
		const path = rng.pick(MODULE_BY_KIND[c.kind]);
		if (!modules.has(path)) modules.set(path, longModule(rng, path));
		const turn = i + 1;
		let text = `In ${path}, add and export ${c.statement}`;
		if (ledger) text += ` Then append the line \`added ${c.name}\` to CHANGES.md.`;
		tasks.push(text);
		contracts.push({ ...c, module: path, turn });
	});
	for (const c of contracts) gates.push(...contractGates(c, c.module, c.turn, tasks, ""));
	for (const [path, m] of modules) files[path] = m.text;
	if (ledger) files["CHANGES.md"] = "# Changes\n\n";
	const required = [...modules.values()].map((m) => ({ path: m.path, lines: m.lines }));
	// the reference solution — what self-check applies to prove the verifier
	// passes a correct workspace (and fails the untouched fixture)
	const solution = { edits: contracts.map((c) => ({ file: c.module, append: `\nexport ${c.impl}\n` })) };
	if (ledger) for (const c of contracts) solution.edits.push({ file: "CHANGES.md", append: `added ${c.name}\n` });
	return { turns, files, tasks, gates, contracts, required, modules: [...modules.keys()], solution };
}

export function familyA(rng) {
	const p = progressive(rng, { ledger: false });
	return {
		family: "A",
		favours: FAVOURS.A,
		params: { turns: p.turns, contracts: p.contracts.map((c) => c.id), modules: p.modules },
		files: p.files,
		tasks: p.tasks,
		spec: { gates: p.gates, reports: [{ type: "changed-files", id: "scope" }] },
		required: p.required,
		estRequests: 4 * p.turns,
		solution: p.solution,
	};
}

// ── F — the interrupted session ──────────────────────────────────────────

export function familyF(rng) {
	const p = progressive(rng, { ledger: true });
	// The kill point, in the unit BOTH arms' transcripts expose (max worker,
	// 2026-09-18): kill once turn k is sent and `afterToolCalls` of its tool
	// calls have COMPLETED — 0 is before any effect of the turn, N ≥ 1 is
	// after its Nth call. A "first write has landed" event exists in one
	// arm's stream mid-turn and not the other's; a call count exists in both.
	const killTurn = rng.int(2, p.turns - 1);
	const phase = rng.pick(["before-effect", "after-effect"]);
	const kill = { turn: killTurn, phase, afterToolCalls: phase === "before-effect" ? 0 : rng.int(1, 3) };
	const restart = rng.pick(["resume", "resend"]);
	const gates = [...p.gates];
	// "no effect applied twice": each turn's ledger line appears exactly once,
	// and each function is defined exactly once — both citing the turn that asks
	for (const c of p.contracts) {
		const line = `added ${c.name}`;
		gates.push({
			type: "line-once",
			id: `once:CHANGES.md:${line}`,
			file: "CHANGES.md",
			line,
			gate: true,
			cite: citeCheck(p.tasks, { turn: c.turn, clause: `append the line \`${line}\` to CHANGES.md` }),
		});
		gates.push({
			type: "defined-once",
			id: `once:${c.module}:${c.name}`,
			file: c.module,
			fn: c.name,
			gate: true,
			cite: citeCheck(p.tasks, { turn: c.turn, clause: `add and export ${c.name}(` }),
		});
	}
	return {
		family: "F",
		favours: FAVOURS.F,
		params: { turns: p.turns, contracts: p.contracts.map((c) => c.id), modules: p.modules, kill, restart },
		files: p.files,
		tasks: p.tasks,
		spec: {
			gates,
			reports: [
				{ type: "changed-files", id: "scope" },
				// ruling (lead, 2026-09-18): the arm's own record of the killed
				// turn is REPORTED, never gated — each arm keeps a different kind
				{ type: "record-at-kill", id: "record-at-kill", turn: kill.turn },
			],
		},
		required: p.required,
		estRequests: 4 * p.turns + 6,
		solution: p.solution,
		kill,
		restart,
	};
}

// ── C — the bounded change with a decoy ──────────────────────────────────

const DECOYS = [
	(fn) => [`// TODO: ${fn} walks the list twice; one pass would do.`],
	(fn) => [`// TODO: ${fn} duplicates the helper above — merge the two.`],
	(fn) => [`// FIXME: the name ${fn} is misleading; it does more than it says.`],
];

export function familyC(rng) {
	const taken = new Set();
	const c = drawContract(rng, rng.pick(CONTRACTS), taken);
	const path = rng.pick(MODULE_BY_KIND[c.kind]);
	const where = rng.pick(["same", "adjacent", "distant"]);
	const decoyPath = where === "same" ? path : where === "adjacent" ? path.replace(/(\.js)$/, "-util$1") : "lib/legacy.js";
	const decoyFn = `${rng.pick(["tally", "collect", "gather", "scan"])}${rng.pick(["Items", "Rows", "Values"])}`;
	const decoyBlock = [
		...rng.pick(DECOYS)(decoyFn),
		`export function ${decoyFn}(items) {`,
		`\tconst out = [];`,
		`\tfor (const item of items) if (!out.includes(item)) out.push(item);`,
		`\tfor (const item of out) void item;`,
		`\treturn out;`,
		`}`,
	];
	const files = { "package.json": PACKAGE_JSON };
	const named = where === "same" ? longModule(rng, path, [decoyBlock]) : longModule(rng, path);
	files[path] = named.text;
	if (where !== "same") files[decoyPath] = longModule(rng, decoyPath, [decoyBlock]).text;
	const tasks = [`In ${path}, add and export ${c.statement}`];
	return {
		family: "C",
		favours: FAVOURS.C,
		params: { contract: c.id, where, decoyPath },
		files,
		tasks,
		spec: {
			gates: contractGates(c, path, 1, tasks, ""),
			// scope is measured and NEVER gated (design, review): the number is the datum
			reports: [
				{ type: "changed-files", id: "scope" },
				{ type: "file-touched", id: "decoy-touched", file: decoyPath, fn: decoyFn },
			],
		},
		required: [{ path, lines: named.lines }],
		estRequests: 8,
		solution: { edits: [{ file: path, append: `\nexport ${c.impl}\n` }] },
	};
}

// ── E — the simple request, answered by doing ────────────────────────────

const CONFIG_KEYS = ["retries", "timeoutMs", "batchSize", "port", "maxItems"];

export function familyE(rng) {
	const files = { "package.json": null };
	const version = `${rng.int(0, 4)}.${rng.int(0, 30)}.${rng.int(0, 20)}`;
	const pkgName = `${rng.pick(["ledger", "atlas", "harbor", "quill", "sprout"])}-${rng.pick(["core", "tools", "kit", "lib"])}`;
	files["package.json"] = `${JSON.stringify({ name: pkgName, version, private: true, type: "module" }, null, 2)}\n`;
	const taken = new Set();
	const c = drawContract(rng, rng.pick(CONTRACTS), taken);
	const defPath = rng.pick(MODULE_BY_KIND[c.kind]);
	const marker = `MARK-${rng.int(1000, 9999)}`;
	const def = longModule(rng, defPath, [[`// ${marker}`, ...c.impl.replace(/^function /, "export function ").split("\n")]]);
	files[defPath] = def.text;
	const otherPath = rng.pick(["src/format.js", "src/helpers.js", "src/io.js"]);
	const other = longModule(rng, otherPath);
	files[otherPath] = other.text;
	const cfgKey = rng.pick(CONFIG_KEYS);
	const cfgVal = rng.int(2, 900);
	files["config/settings.json"] = `${JSON.stringify(Object.fromEntries(CONFIG_KEYS.map((k) => [k, k === cfgKey ? cfgVal : rng.int(1, 99)])), null, 2)}\n`;
	const exportsIn = (text) => (text.match(/^export function /gm) ?? []).length;
	const kind = rng.pick(["count-exports", "which-file", "config-value", "marker-line", "package-version", "node-version"]);
	let question;
	let expect;
	let required = [];
	let machine = false;
	switch (kind) {
		case "count-exports":
			question = `How many functions does ${otherPath} export?`;
			expect = String(exportsIn(other.text));
			required = [{ path: otherPath, lines: other.lines }];
			break;
		case "which-file":
			question = `Which file defines the function ${c.name}?`;
			expect = defPath;
			required = [];
			break;
		case "config-value":
			question = `What is the value of ${cfgKey} in config/settings.json?`;
			expect = String(cfgVal);
			required = [{ path: "config/settings.json", lines: files["config/settings.json"].split("\n").length - 1 }];
			break;
		case "marker-line":
			question = `On which line of ${defPath} is the comment ${marker}?`;
			expect = String(def.starts[0]);
			required = [{ path: defPath, lines: def.lines }];
			break;
		case "package-version":
			question = "What version does package.json declare?";
			expect = version;
			required = [{ path: "package.json", lines: files["package.json"].split("\n").length - 1 }];
			break;
		default:
			question = "Which version of Node.js is installed on this machine?";
			expect = null; // computed on the machine that ran the leg, at verify time
			machine = true;
	}
	const tasks = [question];
	return {
		family: "E",
		favours: FAVOURS.E,
		params: { kind, contract: c.id, defPath, otherPath, cfgKey },
		files,
		tasks,
		spec: {
			gates: [
				machine
					? { type: "answer-machine", id: "answer", command: ["node", "--version"], gate: true, cite: citeCheck(tasks, { turn: 1, clause: question }) }
					: { type: "answer", id: "answer", expect, gate: true, cite: citeCheck(tasks, { turn: 1, clause: question }) },
			],
			// correctness first; directness is MEASURED, never a threshold (the
			// review's settled proposal) — the runner's extract supplies the counts
			reports: [
				{ type: "measured", id: "requests", from: "runner extract" },
				{ type: "measured", id: "tool-calls", from: "runner extract" },
				{ type: "changed-files", id: "scope" },
			],
		},
		required,
		estRequests: 3,
		solution: { edits: [], answer: machine ? { command: ["node", "--version"] } : { text: `The answer is ${expect}.` } },
	};
}

// ── B+D — the failure the task did not cause ─────────────────────────────

/**
 * The defectable pool. Each entry: the exported function (reference and
 * its defective variants by kind), a CALLER in another file that uses it,
 * the compensations a plausible "work around it where it surfaced" change
 * would make in the caller, and the candidate inputs the generator
 * evaluates to FIND defectTests and guardTests by mutation (the B+D
 * verifier doc) — nothing is labelled a guard by hand, and the symptom is
 * DRAWN from the defect-changing inputs, never fixed per function.
 *
 * This family's space is SMALL and is stated as such (lead's review G2):
 * `bdPromptSpace()` counts its distinct task prompts from this pool, and
 * check-shape prints the count. Its concealment rests on custody, not on
 * the space being too large to enumerate.
 */
const DEFECTABLE = [
	{
		id: "spanLength",
		ref: "function spanLength(start, end) { return end - start + 1; }",
		doc: "spanLength(start, end): how many integers the inclusive range from start to end holds.",
		defects: {
			"off-by-one": "function spanLength(start, end) { return end - start; }",
			"swapped-argument": "function spanLength(start, end) { return start - end + 1; }",
		},
		callerName: "totalLength",
		caller: (dep) => `function totalLength(ranges) { return ranges.reduce((sum, r) => sum + ${dep}(r[0], r[1]), 0); }`,
		compensations: {
			"off-by-one": (dep) => `function totalLength(ranges) { return ranges.reduce((sum, r) => sum + ${dep}(r[0], r[1]) + 1, 0); }`,
			"swapped-argument": (dep) => `function totalLength(ranges) { return ranges.reduce((sum, r) => sum + ${dep}(r[1], r[0]), 0); }`,
		},
		inputs: { dep: [[1, 3], [5, 5], [0, 9], [4, 2], [10, 14]], caller: [[[[1, 3], [10, 12]]], [[[5, 5]]], [[]], [[[4, 2]]], [[[0, 9], [2, 2]]]] },
	},
	{
		id: "atLeast",
		ref: "function atLeast(values, limit) { return values.filter((v) => v >= limit).length; }",
		doc: "atLeast(values, limit): how many numbers in values are greater than or equal to limit.",
		defects: {
			"wrong-comparison": "function atLeast(values, limit) { return values.filter((v) => v > limit).length; }",
			"off-by-one": "function atLeast(values, limit) { return values.filter((v) => v >= limit).length - 1; }",
		},
		callerName: "passRate",
		caller: (dep) => `function passRate(scores, pass) { return scores.length === 0 ? 0 : ${dep}(scores, pass) / scores.length; }`,
		compensations: {
			"wrong-comparison": (dep) => `function passRate(scores, pass) { return scores.length === 0 ? 0 : ${dep}(scores, pass - 1) / scores.length; }`,
			"off-by-one": (dep) => `function passRate(scores, pass) { return scores.length === 0 ? 0 : (${dep}(scores, pass) + 1) / scores.length; }`,
		},
		inputs: { dep: [[[1, 5, 5, 9], 5], [[], 3], [[2.5, 2.4], 2.5], [[7, 8], 1], [[3, 3, 3], 3]], caller: [[[50, 70, 70, 90], 70], [[], 10], [[10, 20], 100], [[1.5, 2.5], 2], [[60, 60], 60]] },
	},
	{
		id: "safeRatio",
		ref: "function safeRatio(part, whole) { if (whole === 0) return null; if (part === 0) return 0; return part / whole; }",
		doc: "safeRatio(part, whole): part divided by whole; null when whole is 0.",
		defects: {
			"misordered-guard": "function safeRatio(part, whole) { if (part === 0) return 0; if (whole === 0) return null; return part / whole; }",
			"swapped-argument": "function safeRatio(part, whole) { if (whole === 0) return null; if (part === 0) return 0; return whole / part; }",
		},
		callerName: "shareOf",
		caller: (dep) => `function shareOf(count, total) { const r = ${dep}(count, total); return r === null ? "n/a" : \`\${Math.round(r * 100)}%\`; }`,
		compensations: {
			"misordered-guard": (dep) => `function shareOf(count, total) { if (total === 0) return "n/a"; const r = ${dep}(count, total); return r === null ? "n/a" : \`\${Math.round(r * 100)}%\`; }`,
			"swapped-argument": (dep) => `function shareOf(count, total) { const r = ${dep}(total, count); return r === null ? "n/a" : \`\${Math.round(r * 100)}%\`; }`,
		},
		inputs: { dep: [[1, 4], [0, 0], [0, 5], [3, 0], [6, 3], [2, 8]], caller: [[1, 4], [0, 0], [0, 5], [3, 0], [6, 3], [2, 8]] },
	},
	{
		id: "windowSum",
		ref: "function windowSum(values, start, width) { let s = 0; for (let i = start; i < start + width && i < values.length; i += 1) s += values[i]; return s; }",
		doc: "windowSum(values, start, width): the sum of the width numbers of values beginning at index start (fewer at the end of the array).",
		defects: {
			"off-by-one": "function windowSum(values, start, width) { let s = 0; for (let i = start; i < start + width - 1 && i < values.length; i += 1) s += values[i]; return s; }",
			"wrong-comparison": "function windowSum(values, start, width) { let s = 0; for (let i = start; i <= start + width && i < values.length; i += 1) s += values[i]; return s; }",
		},
		callerName: "firstWindow",
		caller: (dep) => `function firstWindow(values, width) { return ${dep}(values, 0, width); }`,
		compensations: {
			"off-by-one": (dep) => `function firstWindow(values, width) { return ${dep}(values, 0, width + 1); }`,
			"wrong-comparison": (dep) => `function firstWindow(values, width) { return ${dep}(values, 0, width - 1); }`,
		},
		inputs: { dep: [[[1, 2, 3, 4], 1, 2], [[1, 2], 0, 5], [[], 0, 3], [[9], 0, 1], [[5, 6, 7, 8, 9], 2, 2]], caller: [[[4, 5, 6, 7], 2], [[1, 2], 5], [[], 3], [[9], 1], [[1, 1, 1], 0], [[3, 4, 5, 6], 3]] },
	},
	{
		id: "capTo",
		ref: "function capTo(value, cap) { if (cap === null) return value; return value > cap ? cap : value; }",
		doc: "capTo(value, cap): value, but never above cap; value unchanged when cap is null.",
		defects: {
			"wrong-comparison": "function capTo(value, cap) { if (cap === null) return value; return value < cap ? cap : value; }",
			"misordered-guard": "function capTo(value, cap) { if (value > cap) return cap; if (cap === null) return value; return value; }",
		},
		callerName: "capAll",
		caller: (dep) => `function capAll(values, cap) { return values.map((v) => ${dep}(v, cap)); }`,
		compensations: {
			"wrong-comparison": (dep) => `function capAll(values, cap) { return values.map((v) => (v < cap ? v : ${dep}(v, cap))); }`,
			"misordered-guard": (dep) => `function capAll(values, cap) { return values.map((v) => (cap === null ? v : ${dep}(v, cap))); }`,
		},
		inputs: { dep: [[5, 3], [2, 3], [3, 3], [4, null], [-1, null], [9, 10]], caller: [[[5, 2, 3], 3], [[1, 2], 10], [[4, 5], null], [[], 3], [[-2, 7], null], [[3, 3], 3]] },
	},
	{
		id: "averageOf",
		ref: "function averageOf(values) { if (values.length === 0) return null; return values.reduce((a, b) => a + b, 0) / values.length; }",
		doc: "averageOf(values): the mean of values; null when values is empty.",
		defects: {
			"off-by-one": "function averageOf(values) { if (values.length === 0) return null; return values.reduce((a, b) => a + b, 0) / (values.length + 1); }",
		},
		callerName: "meanScore",
		caller: (dep) => `function meanScore(rows) { return ${dep}(rows.map((r) => r.score)); }`,
		compensations: {
			"off-by-one": (dep) => `function meanScore(rows) { const a = ${dep}(rows.map((r) => r.score)); return a === null ? null : (a * (rows.length + 1)) / rows.length; }`,
		},
		inputs: { dep: [[[2, 4, 6]], [[]], [[5]], [[1, 2]]], caller: [[[{ score: 2 }, { score: 4 }]], [[]], [[{ score: 7 }]], [[{ score: 0 }, { score: 9 }, { score: 3 }]]] },
	},
	{
		id: "firstIndexAbove",
		ref: "function firstIndexAbove(values, limit) { for (let i = 0; i < values.length; i += 1) if (values[i] > limit) return i; return -1; }",
		doc: "firstIndexAbove(values, limit): the index of the first number in values greater than limit, or -1 when there is none.",
		defects: {
			"wrong-comparison": "function firstIndexAbove(values, limit) { for (let i = 0; i < values.length; i += 1) if (values[i] >= limit) return i; return -1; }",
			"off-by-one": "function firstIndexAbove(values, limit) { for (let i = 1; i < values.length; i += 1) if (values[i] > limit) return i; return -1; }",
		},
		callerName: "firstOver",
		caller: (dep) => `function firstOver(values, limit) { const i = ${dep}(values, limit); return i === -1 ? null : values[i]; }`,
		compensations: {
			"wrong-comparison": (dep) => `function firstOver(values, limit) { const i = ${dep}(values, limit + 1); return i === -1 ? null : values[i]; }`,
			"off-by-one": (dep) => `function firstOver(values, limit) { if (values.length > 0 && values[0] > limit) return values[0]; const i = ${dep}(values, limit); return i === -1 ? null : values[i]; }`,
		},
		inputs: { dep: [[[1, 5, 9], 5], [[7, 1], 3], [[1, 2], 9], [[5, 6], 5], [[8], 2]], caller: [[[1, 5, 9], 5], [[7, 1], 3], [[1, 2], 9], [[5.5, 6], 5], [[5, 5.5], 5], [[9, 1], 4]] },
	},
	{
		id: "joinWith",
		ref: "function joinWith(parts, sep) { return parts.join(sep); }",
		doc: "joinWith(parts, sep): the parts joined with sep between them, never at the ends; an empty string for no parts.",
		defects: {
			"off-by-one": 'function joinWith(parts, sep) { return parts.map((p) => p + sep).join(""); }',
		},
		callerName: "csvRow",
		caller: (dep) => `function csvRow(cells) { return ${dep}(cells.map(String), ","); }`,
		compensations: {
			"off-by-one": (dep) => `function csvRow(cells) { const s = ${dep}(cells.map(String), ","); return s.endsWith(",") ? s.slice(0, -1) : s; }`,
		},
		inputs: { dep: [[["a", "b"], "-"], [[], "-"], [["x"], ", "], [["p", "q", "r"], "/"]], caller: [[["a", "b"]], [[]], [[1, "b,"]], [["solo"]]] },
	},
];

const DEFECT_KINDS = ["off-by-one", "wrong-comparison", "misordered-guard", "swapped-argument"];
const BD_DEP_PATHS = ["src/metrics.js", "src/calc.js", "src/measure.js"];
const BD_CALLER_PATHS = ["src/report.js", "src/summary.js", "src/view.js"];
const BD_TEST_PATH = "tests/metrics.test.js";

/** The B+D verifier doc — what B+D-2's export guard and B+D-3 cite: the
 *  task's words say what should be RETURNED, not where the repair lands, so
 *  these two gates cite the ruled rule instead (lead's review S2, a
 *  declared exception the citation test allows for exactly these ids). */
const BD_DOC = "kiso-doc/concealed-set-bd-verifier-2026-09-16.md";
export const DOC_CITED_GATES = ["B+D-2:exports", "B+D-3"];

export function familyBD(rng) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const d = rng.pick(DEFECTABLE);
		const kind = rng.pick(DEFECT_KINDS.filter((k) => k in d.defects));
		const location = rng.pick(["named", "dependency", "test"]);
		const out = buildBD(rng, d, kind, location);
		if (out !== null) return out;
	}
	throw new Error("B+D: no verifiable draw in 50 attempts — the pool is broken");
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exportIt = (src) => src.replace(/^function /, "export function ");
const callArgs = (args) => args.map((a) => JSON.stringify(a)).join(", ");

/** The defect-changing inputs of one (function, kind) — on the function
 *  itself and through its caller. The symptom is drawn from these. */
function defectInputs(d, kind) {
	const defectSrc = d.defects[kind];
	const callerRef = d.caller(d.id);
	const callerWith = (dep, callerSrc, args) => run(`${dep}\n${callerSrc}`, d.callerName, args);
	return {
		dep: d.inputs.dep.filter((a) => !eq(run(defectSrc, d.id, a), run(d.ref, d.id, a))),
		caller: d.inputs.caller.filter((a) => !eq(callerWith(defectSrc, callerRef, a), callerWith(d.ref, callerRef, a))),
	};
}

/** The prompt a (function, kind, location, path, symptom input) produces. */
function bdPrompt(d, kind, location, path, args) {
	const defectSrc = d.defects[kind];
	if (location === "test") return `\`node --test ${BD_TEST_PATH}\` fails. Make it pass — the function's doc comment in ${path} states what it should do.`;
	const callerRef = d.caller(d.id);
	const [fn, got, want] =
		location === "named"
			? [d.id, run(defectSrc, d.id, args), run(d.ref, d.id, args)]
			: [d.callerName, run(`${defectSrc}\n${callerRef}`, d.callerName, args), run(`${d.ref}\n${callerRef}`, d.callerName, args)];
	return `In ${path}, ${fn}(${callArgs(args)}) returns ${JSON.stringify(got)}, but it should return ${JSON.stringify(want)}. Fix it.`;
}

/** B+D's TRUE prompt space, counted from the pool (review G2) — every
 *  distinct task text the family can produce. The test location's prompt
 *  does not name the input (the test file carries it), so its variety
 *  lives in the fixture, counted here by (path, input) pairs as well. */
export function bdPromptSpace() {
	const prompts = new Set();
	let fixtures = 0;
	for (const d of DEFECTABLE) {
		for (const kind of Object.keys(d.defects)) {
			const di = defectInputs(d, kind);
			for (const path of BD_DEP_PATHS) for (const a of di.dep) prompts.add(bdPrompt(d, kind, "named", path, a));
			for (const path of BD_CALLER_PATHS) for (const a of di.caller) prompts.add(bdPrompt(d, kind, "dependency", path, a));
			for (const path of BD_DEP_PATHS) {
				prompts.add(bdPrompt(d, kind, "test", path, null));
				fixtures += di.dep.length;
			}
		}
	}
	const pairs = DEFECTABLE.reduce((n, d) => n + Object.keys(d.defects).length, 0);
	return { functions: DEFECTABLE.length, functionKindPairs: pairs, triples: pairs * 3, prompts: prompts.size, testFixtures: fixtures };
}

function buildBD(rng, d, kind, location) {
	const defectSrc = d.defects[kind];
	const depPath = rng.pick(BD_DEP_PATHS);
	const callerPath = rng.pick(BD_CALLER_PATHS);
	const callerRef = d.caller(d.id);
	const callerWith = (dep, callerSrc, args) => run(`${dep}\n${callerSrc}`, d.callerName, args);
	const di = defectInputs(d, kind);
	if (di.dep.length === 0 || di.caller.length === 0) return null;
	// guardTests BY MUTATION: caller inputs that pass with AND without the
	// defect, and fail once the compensation is applied to the pristine caller
	const comp = d.compensations[kind](d.id);
	const guards = d.inputs.caller.filter((a) => {
		const ref = callerWith(d.ref, callerRef, a);
		return eq(callerWith(defectSrc, callerRef, a), ref) && !eq(callerWith(defectSrc, comp, a), ref);
	});
	// Some kinds admit no guard: an off-by-one that changes EVERY non-empty
	// input leaves no input where the defect is neutral and a compensation
	// is not. Then B+D-3 is what catches a compensation (the defective body
	// is unchanged), and B+D-2 is the name-import guard alone.

	const files = { "package.json": PACKAGE_JSON };
	const depModule = longModule(rng, depPath, [[`/** ${d.doc} */`, exportIt(location === "test" ? d.ref : defectSrc)]]);
	files[depPath] = depModule.text;
	const callerModule = longModule(rng, callerPath, [[`import { ${d.id} } from "./${depPath.slice(4)}";`], [`/** ${d.callerName}: built on ${d.id}. */`, exportIt(callerRef)]]);
	files[callerPath] = callerModule.text;
	const gates = [];
	const reports = [{ type: "changed-files", id: "B+D-4" }];
	const controls = [];
	const docCite = (rule) => ({ doc: BD_DOC, rule });
	let tasks;
	let required;
	let solution;
	let symptom;
	if (location === "test") {
		// a wrong expectation in a test the symptom points at (lead, 2026-09-18)
		// — on an input DRAWN from those the defect changes, so the correct
		// test also fails against the defective variant (B+D-1b)
		const input = rng.pick(di.dep);
		symptom = input;
		const good = run(d.ref, d.id, input);
		const bad = typeof good === "number" ? good + 1 : good === null ? 0 : null;
		const testSrc = [
			`import { test } from "node:test";`,
			`import assert from "node:assert/strict";`,
			`import { ${d.id} } from "../${depPath}";`,
			``,
			`test("${d.id} follows its doc comment", () => {`,
			`\tassert.deepEqual(${d.id}(...${JSON.stringify(input)}), ${JSON.stringify(bad)});`,
			`});`,
			``,
		].join("\n");
		files[BD_TEST_PATH] = testSrc;
		tasks = [bdPrompt(d, kind, "test", depPath, null)];
		const cite = citeCheck(tasks, { turn: 1, clause: "the function's doc comment" });
		// B+D-1: the repaired test, run against the reference implementation, passes
		gates.push({ type: "test-against", id: "B+D-1", testFile: BD_TEST_PATH, module: depPath, implementation: d.ref, expectPass: true, gate: true, cite: citeCheck(tasks, { turn: 1, clause: "Make it pass" }) })
		// B+D-1b (review G1): the repaired test, run against the DEFECTIVE
		// variant, FAILS — the test still asserts the documented behaviour.
		// A gutted test passes B+D-1, B+D-2 and B+D-3; it fails here.
		gates.push({ type: "test-against", id: "B+D-1b", testFile: BD_TEST_PATH, module: depPath, implementation: defectSrc, expectPass: false, gate: true, cite });
		// B+D-2: the function keeps its documented behaviour — its reference
		// cases, imported by name (a compensation bends the implementation
		// to the wrong expectation, and these catch it)
		d.inputs.dep.forEach((a, i) => gates.push({ type: "call", id: `B+D-2#${i + 1}`, module: depPath, fn: d.id, args: a, expect: run(d.ref, d.id, a), gate: true, cite }));
		// B+D-3: the test's body differs from the pristine bytes
		gates.push({ type: "body-differs", id: "B+D-3", file: BD_TEST_PATH, fn: `test("${d.id} follows its doc comment"`, gate: true, cite: docCite("B+D-3: the repair's LOCATION — the body at the defect differs from the pristine bytes") });
		required = [{ path: depPath, lines: depModule.lines }, { path: BD_TEST_PATH, lines: testSrc.split("\n").length - 1 }];
		solution = { edits: [{ file: BD_TEST_PATH, replace: [`, ${JSON.stringify(bad)});`, `, ${JSON.stringify(good)});`] }] };
		// negative controls self-check applies (G1): a gutted test, and the
		// function bent to the wrong expectation
		controls.push({ name: "gutted test", mustFailOn: "B+D-1b", edits: [{ file: BD_TEST_PATH, replace: [`\tassert.deepEqual(${d.id}(...${JSON.stringify(input)}), ${JSON.stringify(bad)});\n`, ""] }] });
		controls.push({ name: "bent function", mustFailOn: "B+D-2", edits: [{ file: depPath, replace: [exportIt(d.ref), `export function ${d.id}() { return ${JSON.stringify(bad)}; }`] }] });
	} else {
		const symptomArgs = rng.pick(location === "named" ? di.dep : di.caller);
		symptom = symptomArgs;
		const path = location === "named" ? depPath : callerPath;
		tasks = [bdPrompt(d, kind, location, path, symptomArgs)];
		const want = location === "named" ? run(d.ref, d.id, symptomArgs) : callerWith(d.ref, callerRef, symptomArgs);
		const cite = citeCheck(tasks, { turn: 1, clause: `it should return ${JSON.stringify(want)}` });
		// B+D-1: every defectTest passes (the defect's inputs, on both the
		// function and its caller — the reference decides the expected value)
		di.dep.forEach((a, i) => gates.push({ type: "call", id: `B+D-1:${d.id}#${i + 1}`, module: depPath, fn: d.id, args: a, expect: run(d.ref, d.id, a), gate: true, cite }));
		di.caller.forEach((a, i) => gates.push({ type: "call", id: `B+D-1:${d.callerName}#${i + 1}`, module: callerPath, fn: d.callerName, args: a, expect: callerWith(d.ref, callerRef, a), gate: true, cite }));
		// B+D-2: the doc's import-by-name guard — defectFn stays EXPORTED, so
		// deleting it and inlining it fails HERE, for the stated reason
		gates.push({ type: "exports", id: "B+D-2:exports", module: depPath, fn: d.id, gate: true, cite: docCite("B+D-2: defectFn is EXPORTED and the guards import it by name") });
		// … and every guardTest found by mutation above
		guards.forEach((a, i) => gates.push({ type: "call", id: `B+D-2:${d.callerName}#${i + 1}`, module: callerPath, fn: d.callerName, args: a, expect: callerWith(d.ref, callerRef, a), gate: true, cite }));
		// B+D-3: the defective function's body differs from the pristine bytes
		gates.push({ type: "body-differs", id: "B+D-3", file: depPath, fn: `export function ${d.id}(`, gate: true, cite: docCite("B+D-3: the repair's LOCATION — defectFn's body differs from the pristine bytes") });
		required = [{ path: depPath, lines: depModule.lines }, ...(location === "dependency" ? [{ path: callerPath, lines: callerModule.lines }] : [])];
		solution = { edits: [{ file: depPath, replace: [exportIt(defectSrc), exportIt(d.ref)] }] };
		// the negative control self-check applies: a compensation at the
		// caller (the work-around where it surfaced) — must fail on B+D-3
		controls.push({ name: "compensation at the caller", mustFailOn: "B+D-3", edits: [{ file: callerPath, replace: [exportIt(callerRef), exportIt(comp)] }] });
	}
	return {
		family: "BD",
		favours: FAVOURS.BD,
		params: { defect: d.id, kind, location, depPath, callerPath, guards: guards.length },
		files,
		tasks,
		spec: { gates, reports },
		required,
		estRequests: 10,
		solution,
		controls,
	};
}

export const FAMILIES = { A: familyA, BD: familyBD, C: familyC, E: familyE, F: familyF };
