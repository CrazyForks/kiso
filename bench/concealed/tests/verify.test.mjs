/**
 * The verifier, end to end on materialised throwaway-seed instances: each
 * family's positive (the reference solution passes), its negative (the
 * untouched fixture fails), and the specific reds the review asks for —
 * B+D-3's byte comparison against a compensating change, and F's "no effect
 * applied twice". Nothing materialised here is kept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAll, generateInstance } from "../generate.mjs";
import { materialize } from "../materialize.mjs";
import { answerHas, verify } from "../verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

/** Every temp dir THIS process made — and only those are removed at exit:
 *  a prefix sweep could delete another process's dirs on a shared machine. */
const made = [];
function scratch() {
	const d = mkdtempSync(join(tmpdir(), "kiso-concealed-test-"));
	made.push(d);
	return d;
}

/** Materialise the first instance of `family` (and optional predicate) for a seed. */
function materialized(seed, family, pred = () => true) {
	const inst = generateAll(seed).find((i) => i.family === family && pred(i));
	assert.ok(inst, `no ${family} instance matching the predicate in ${seed}`);
	const dir = join(scratch(), "inst");
	materialize(inst, dir);
	return { inst, dir };
}

function workspace(dir, edits = []) {
	const ws = scratch();
	cpSync(join(dir, "fixture"), ws, { recursive: true });
	for (const e of edits) {
		const p = join(ws, e.file);
		const t = readFileSync(p, "utf8");
		writeFileSync(p, e.append !== undefined ? t + e.append : t.replace(e.replace[0], e.replace[1]));
	}
	return ws;
}

const solution = (dir) => JSON.parse(readFileSync(join(dir, "verifier", "solution.json"), "utf8"));

test("self-check proves every instance of several throwaway seeds", () => {
	for (const seed of ["throwaway-self-1", "throwaway-self-2", "throwaway-self-3"]) {
		const out = execFileSync(process.execPath, [CLI, "self-check", "--seed", seed], { encoding: "utf8" });
		assert.match(out, /every instance's verifier is proven/, out);
	}
});

test("A: the untouched fixture fails with named, cited assertions; the reference passes", () => {
	const { dir } = materialized("throwaway-a", "A");
	const bad = verify({ instanceDir: dir, workspace: workspace(dir) });
	assert.equal(bad.verdict, "fail");
	const g = bad.gates.find((x) => !x.pass);
	assert.match(g.detail, /is not exported/);
	assert.ok(g.cite.clause.length > 0 && typeof g.cite.turn === "number");
	const good = verify({ instanceDir: dir, workspace: workspace(dir, solution(dir).edits) });
	assert.equal(good.verdict, "pass", JSON.stringify(good.gates.filter((x) => !x.pass)));
});

test("B+D-3 is RED on a compensating change — the byte comparison, not a judgement", () => {
	const { dir } = materialized("throwaway-bd", "BD", (i) => i.params.location !== "test");
	const controls = JSON.parse(readFileSync(join(dir, "verifier", "controls.json"), "utf8"));
	const comp = controls.find((c) => c.mustFailOn === "B+D-3");
	const r = verify({ instanceDir: dir, workspace: workspace(dir, comp.edits) });
	assert.equal(r.verdict, "fail");
	const b3 = r.gates.find((g) => g.id === "B+D-3");
	assert.equal(b3.pass, false);
	assert.match(b3.detail, /byte-identical to the pristine fixture/);
	// and the repair AT the defect passes all four
	const fixed = verify({ instanceDir: dir, workspace: workspace(dir, solution(dir).edits) });
	assert.equal(fixed.verdict, "pass", JSON.stringify(fixed.gates.filter((x) => !x.pass)));
	assert.ok(fixed.reports.find((x) => x.id === "B+D-4").value.modified.length >= 1, "B+D-4 reports the changed files");
});

test("B+D: deleting the defective function fails B+D-2 (the export guard) first, for the stated reason", () => {
	const { inst, dir } = materialized("throwaway-bd", "BD", (i) => i.params.location !== "test");
	const ws = workspace(dir);
	const p = join(ws, inst.params.depPath);
	writeFileSync(p, readFileSync(p, "utf8").replace(`export function ${inst.params.defect}(`, `function ${inst.params.defect}_gone(`));
	const r = verify({ instanceDir: dir, workspace: ws });
	assert.equal(r.gates.find((g) => g.id === "B+D-2:exports").pass, false);
});

test("B+D location=test: the fixed expectation passes against the reference; bending the function fails B+D-2", () => {
	let found = null;
	for (let s = 0; s < 30 && found === null; s += 1) {
		const inst = generateAll(`throwaway-bdt-${s}`).find((i) => i.family === "BD" && i.params.location === "test");
		if (inst) found = inst;
	}
	assert.ok(found, "no location=test draw in 30 throwaway seeds");
	const dir = join(scratch(), "inst");
	materialize(found, dir);
	const good = verify({ instanceDir: dir, workspace: workspace(dir, solution(dir).edits) });
	assert.equal(good.verdict, "pass", JSON.stringify(good.gates.filter((x) => !x.pass)));
	const untouched = verify({ instanceDir: dir, workspace: workspace(dir) });
	assert.equal(untouched.gates.find((g) => g.id === "B+D-3").pass, false, "an unchanged test is not a repair");
	// G1: a GUTTED test passes B+D-1, B+D-2 and B+D-3 — and fails B+D-1b
	const gut = JSON.parse(readFileSync(join(dir, "verifier", "controls.json"), "utf8")).find((c) => c.mustFailOn === "B+D-1b");
	const gutted = verify({ instanceDir: dir, workspace: workspace(dir, gut.edits) });
	assert.equal(gutted.verdict, "fail");
	const b1b = gutted.gates.find((g) => g.id === "B+D-1b");
	assert.equal(b1b.pass, false);
	assert.match(b1b.detail, /DEFECTIVE variant/);
	for (const id of ["B+D-1", "B+D-3"]) assert.equal(gutted.gates.find((g) => g.id === id).pass, true, `${id} alone would have accepted the gutted test`);
	// bending the FUNCTION to the wrong expectation (the compensation for this
	// location) breaks its reference cases — B+D-2, imported by name
	const ws = workspace(dir);
	const dep = join(ws, found.params.depPath);
	const text = readFileSync(dep, "utf8");
	const line = text.split("\n").find((l) => l.startsWith(`export function ${found.params.defect}(`));
	writeFileSync(dep, text.replace(line, `export function ${found.params.defect}() { return "bent"; }`));
	const bent = verify({ instanceDir: dir, workspace: ws });
	assert.ok(bent.gates.some((g) => g.id.startsWith("B+D-2") && !g.pass), "bending the function must fail its reference cases");
});

test("F: an effect applied twice is RED — a doubled ledger line, and a function defined twice", () => {
	const { inst, dir } = materialized("throwaway-f", "F");
	const edits = solution(dir).edits;
	const first = inst.params.contracts.length > 0 ? edits.find((e) => e.file === "CHANGES.md") : null;
	const twiceLine = verify({ instanceDir: dir, workspace: workspace(dir, [...edits, first]) });
	assert.equal(twiceLine.verdict, "fail");
	assert.ok(twiceLine.gates.some((g) => g.id.startsWith("once:CHANGES.md") && !g.pass && /2 occurrence/.test(g.detail)));
	const fnEdit = edits.find((e) => e.file !== "CHANGES.md");
	const twiceFn = verify({ instanceDir: dir, workspace: workspace(dir, [...edits, { file: fnEdit.file, append: fnEdit.append.replace("export ", "") }]) });
	assert.ok(twiceFn.gates.some((g) => g.type === "defined-once" && !g.pass && /2 definition/.test(g.detail)));
	const once = verify({ instanceDir: dir, workspace: workspace(dir, edits) });
	assert.equal(once.verdict, "pass", JSON.stringify(once.gates.filter((x) => !x.pass)));
	const meta = JSON.parse(readFileSync(join(dir, "instance.json"), "utf8"));
	assert.ok(meta.kill.turn >= 2 && meta.kill.turn < meta.turns);
	assert.ok(meta.kill.phase === "before-effect" ? meta.kill.afterToolCalls === 0 : meta.kill.afterToolCalls >= 1);
});

test("E: correctness is a TOKEN of the answer; requests and tool calls are reported, never gated", () => {
	let found = null;
	for (let s = 0; s < 40 && found === null; s += 1) {
		const inst = generateAll(`throwaway-e-${s}`).find((i) => i.family === "E" && i.spec.gates[0].type === "answer" && /^\d+$/.test(i.spec.gates[0].expect));
		if (inst) found = inst;
	}
	assert.ok(found, "no numeric E draw in 40 throwaway seeds");
	const dir = join(scratch(), "inst");
	materialize(found, dir);
	const expect = found.spec.gates[0].expect;
	const ans = (text) => {
		const f = join(scratch(), "answer.txt");
		writeFileSync(f, `${text}\n`);
		return verify({ instanceDir: dir, workspace: workspace(dir), answerFile: f });
	};
	assert.equal(ans(`It is ${expect}.`).verdict, "pass");
	assert.equal(ans(`It is ${expect}0.`).verdict, "fail", "a longer number that contains the answer is not the answer");
	assert.equal(ans("I'd need more context to say.").verdict, "fail");
	const r = ans(`${expect}`);
	for (const id of ["requests", "tool-calls"]) {
		const rep = r.reports.find((x) => x.id === id);
		assert.equal(rep.class, "REPORTED");
		assert.ok(!r.gates.some((g) => g.id === id), `${id} must never be a gate`);
	}
});

test("F: a list-writing arm's bulleted ledger counts; a doubled bullet is still doubled (review G7)", () => {
	const { dir } = materialized("throwaway-f", "F");
	const edits = solution(dir).edits.map((e) => (e.file === "CHANGES.md" ? { ...e, append: `- ${e.append}` } : e));
	const bulleted = verify({ instanceDir: dir, workspace: workspace(dir, edits) });
	assert.equal(bulleted.verdict, "pass", JSON.stringify(bulleted.gates.filter((x) => !x.pass)));
	const firstLedger = edits.find((e) => e.file === "CHANGES.md");
	const doubled = verify({ instanceDir: dir, workspace: workspace(dir, [...edits, { file: "CHANGES.md", append: `* ${firstLedger.append.slice(2)}` }]) });
	assert.ok(doubled.gates.some((g) => g.type === "line-once" && !g.pass && /2 occurrence/.test(g.detail)));
});

test("E: the answer boundary — each case the review found, pinned (G3)", () => {
	const cases = [
		["It is 4.", "4", true],
		["4.5", "4", false],
		["-4", "4", false],
		["5-8", "5", false],
		["5-8", "8", false],
		["1.28.4.1", "1.28.4", false],
		["v1.28.4", "1.28.4", true],
		["It is 4 or 5.", "4", false],
		["Either 1.28.4 or 1.28.5.", "1.28.4", false],
		["120", "12", false],
		["./src/order.js", "src/order.js", true],
	];
	for (const [text, expect, want] of cases) assert.equal(answerHas(text, expect), want, `${JSON.stringify(text)} for ${expect}`);
	// echoing a number the question itself contains is not a hedge
	assert.equal(answerHas("The comment MARK-4821 is on line 57.", "57", "On which line of src/x.js is the comment MARK-4821?"), true);
});

test("C: touching the decoy is reported, never a failure", () => {
	const { inst, dir } = materialized("throwaway-c", "C");
	const decoy = inst.params.decoyPath;
	const edits = [...solution(dir).edits, { file: decoy, append: "\n// tidied\n" }];
	const r = verify({ instanceDir: dir, workspace: workspace(dir, edits) });
	assert.equal(r.verdict, "pass", JSON.stringify(r.gates.filter((x) => !x.pass)));
	assert.equal(r.reports.find((x) => x.id === "decoy-touched").value.touched, true);
});

test("verify's CLI prints ONE word and writes verify.json with the citations", () => {
	const { dir } = materialized("throwaway-cli", "C");
	const ws = workspace(dir, solution(dir).edits);
	const out = scratch();
	const stdout = execFileSync(process.execPath, [CLI, "verify", "--instance-dir", dir, "--workspace", ws, "--out", out], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	assert.equal(stdout, "pass\n");
	const body = JSON.parse(readFileSync(join(out, "verify.json"), "utf8"));
	assert.equal(body.verdict, "pass");
	assert.ok(body.gates.every((g) => g.cite && g.cite.clause));
	assert.equal(body.favours, "ours by tuning");
});

test("a hanging function fails only its own module's gates (review S1)", () => {
	const { inst, dir } = materialized("throwaway-a", "A", (i) => i.params.modules.length >= 2);
	const edits = solution(dir).edits;
	const [hangMod] = inst.params.modules;
	const ws = workspace(dir, edits);
	writeFileSync(join(ws, hangMod), `${readFileSync(join(ws, hangMod), "utf8")}\nwhile (true) {}\n`);
	const r = verify({ instanceDir: dir, workspace: ws });
	const callGates = r.gates.filter((g) => g.type === "call");
	assert.ok(callGates.some((g) => g.pass), "a hang in one module failed every call gate");
	assert.ok(callGates.some((g) => !g.pass));
});

test("the CLI refuses unknown flags and check-shape --seed reports one seed (review S3, G6)", () => {
	assert.throws(() => execFileSync(process.execPath, [CLI, "check-shape", "--sed", "x"], { encoding: "utf8", stdio: "pipe" }), /unknown flag --sed/);
	let out = "";
	let code = 0;
	try {
		out = execFileSync(process.execPath, [CLI, "check-shape", "--seed", "throwaway-one"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch (err) {
		out = err.stdout;
		code = err.status;
	}
	assert.match(out, /this seed: A 6, BD 6, C 6, E 6, F 6/);
	assert.match(out, /over 200 lines: \d+\.\d%/);
	assert.ok(/IN BAND/.test(out) ? code === 0 : code === 1, "out of band exits non-zero");
	assert.doesNotMatch(out, /function|export|src\//, "a seed report carries no instance content");
});

test("materialize refuses a non-empty directory", () => {
	const dir = scratch();
	writeFileSync(join(dir, "stale"), "x");
	assert.throws(() => materialize(generateInstance("throwaway-m", "A-1"), dir), /not empty/);
});

test("no materialised instance is committed — only the generator's source", () => {
	const root = join(HERE, "..", "..", "..");
	const tracked = execFileSync("git", ["ls-files", "bench/concealed"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
	for (const f of tracked) assert.doesNotMatch(f, /(tasks\.json|instance\.json|spec\.json|solution\.json|verify\.json)$/, `a materialised file is tracked: ${f}`);
	assert.deepEqual(readdirSync(join(HERE, "..")).filter((n) => /^(inst|instances?|out)$/.test(n)), []);
});

process.on("exit", () => {
	for (const d of made) rmSync(d, { recursive: true, force: true });
});
