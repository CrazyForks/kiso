/**
 * Score a finished leg's workspace against a materialised instance.
 *
 * Prints ONE word — pass / fail — the t5/t6 verifier contract the runner
 * already reads, and writes verify.json with every assertion: GATE or
 * REPORTED, its result, and the statement it cites (turn + clause).
 *
 * The verdict is the gates alone. Reports (scope, the decoy, E's measured
 * directness, F's record at the kill) are data, never a failure.
 *
 * Everything the workspace offers is untrusted: the arm wrote it. Calls run
 * in a child process with a timeout, one try/catch per call, so a function
 * that hangs or throws fails its own assertion and nothing else.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const CALL_TIMEOUT_MS = 30_000;
/** Not part of the work: dependencies, and every dot-directory — VCS and any
 *  agent's own state. The fixtures ship no dotfiles, so nothing is lost. */
const ignored = (name) => name === "node_modules" || name.startsWith(".");

function listFiles(root) {
	const out = [];
	const walk = (dir) => {
		if (!existsSync(dir)) return;
		for (const name of readdirSync(dir).sort()) {
			if (ignored(name)) continue;
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else out.push(relative(root, p));
		}
	};
	walk(root);
	return out;
}

/** Run the call gates ONE CHILD PER MODULE (review S1): a function that
 *  hangs fails the gates of its own module, never every call gate. */
function runCalls(workspace, calls) {
	const out = new Array(calls.length);
	const byModule = new Map();
	calls.forEach((c, i) => byModule.set(c.module, [...(byModule.get(c.module) ?? []), i]));
	for (const idx of byModule.values()) {
		const res = runModuleCalls(workspace, idx.map((i) => calls[i]));
		idx.forEach((i, k) => {
			out[i] = res[k];
		});
	}
	return out;
}

function runModuleCalls(workspace, calls) {
	if (calls.length === 0) return [];
	const script = `
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const calls = JSON.parse(process.argv[2]);
const out = [];
for (const c of calls) {
	try {
		const mod = await import(pathToFileURL(resolve(${JSON.stringify(workspace)}, c.module)).href);
		if (c.type === "exports") { out.push({ ok: true, value: typeof mod[c.fn] === "function" }); continue; }
		if (typeof mod[c.fn] !== "function") { out.push({ ok: false, error: c.fn + " is not exported by " + c.module }); continue; }
		const value = await mod[c.fn](...c.args);
		out.push({ ok: true, value: value === undefined ? "__undefined__" : value });
	} catch (err) {
		out.push({ ok: false, error: String(err && err.message ? err.message : err) });
	}
}
process.stdout.write(JSON.stringify(out));
`;
	const dir = mkdtempSync(join(tmpdir(), "kiso-concealed-call-"));
	const file = join(dir, "calls.mjs");
	writeFileSync(file, script, "utf8");
	try {
		const r = spawnSync(process.execPath, [file, JSON.stringify(calls)], { encoding: "utf8", timeout: CALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
		if (r.status !== 0 || r.stdout === "") return calls.map(() => ({ ok: false, error: r.error ? String(r.error.message) : `the call process exited ${r.status}: ${(r.stderr ?? "").slice(0, 400)}` }));
		return JSON.parse(r.stdout);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** The block that starts at the line containing `marker`: to the line where
 *  its braces balance (a one-line function is its own block). */
function extractBlock(text, marker) {
	const lines = text.split("\n");
	const at = lines.findIndex((l) => l.includes(marker));
	if (at < 0) return null;
	let depth = 0;
	let opened = false;
	const out = [];
	for (let i = at; i < lines.length; i += 1) {
		out.push(lines[i]);
		for (const ch of lines[i]) {
			if (ch === "{" || ch === "(") {
				depth += 1;
				opened = true;
			} else if (ch === "}" || ch === ")") depth -= 1;
		}
		if (opened && depth <= 0) break;
	}
	return out.join("\n");
}

function readOr(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The numbers an answer states: integers, decimals and dotted versions,
 *  signed only where the sign is not glued to a word ("MARK-4821" is a
 *  marker, not minus 4821). */
function numbersIn(text) {
	return [...text.matchAll(/(?<![\w.])(?:v(?=\d))?-?\d+(?:\.\d+)*(?![\w])/g)].map((m) => m[0].replace(/\.$/, "").replace(/^v/, ""));
}

/**
 * The expected value as a TOKEN of the answer (review G3). Neither side of
 * the token may continue it: not a word character, a dot followed by a
 * digit, or a dash — so "4" is not in "4.5", "-4" or "5-8", and "1.28.4" is
 * not in "1.28.4.1". A sentence's own full stop still ends a token.
 *
 * When a NUMBER is expected, an answer stating more than one distinct
 * number fails: a hedge is not a verified answer. Numbers the question
 * itself contains (a marker, a key) are not counted — echoing the question
 * is not hedging.
 */
export function answerHas(answer, expect, question = "") {
	const e = String(expect);
	const variants = [e];
	if (/^[\w./-]+\.js$/.test(e)) variants.push(`./${e}`);
	const version = /^v?\d+(\.\d+)*$/.test(e);
	if (version) variants.push(e.replace(/^v/, ""), `v${e.replace(/^v/, "")}`);
	const found = variants.some((v) => new RegExp(`(^|[^\\w.-])${escapeRe(v)}($|[^\\w.-]|\\.(?!\\d))`).test(answer));
	if (!found) return false;
	if (!version) return true;
	const asked = new Set(numbersIn(question));
	const stated = new Set(numbersIn(answer).filter((n) => !asked.has(n)).map((n) => n.replace(/^v/, "")));
	return stated.size <= 1;
}

export function verify({ instanceDir, workspace, answerFile, outDir }) {
	const spec = JSON.parse(readFileSync(join(instanceDir, "verifier", "spec.json"), "utf8"));
	const meta = JSON.parse(readFileSync(join(instanceDir, "instance.json"), "utf8"));
	const pristineRoot = join(instanceDir, "verifier", "pristine");
	const results = [];
	const add = (g, pass, detail) => results.push({ id: g.id, type: g.type, class: g.gate ? "GATE" : "REPORTED", pass, detail, cite: g.cite ?? null });

	const callGates = spec.gates.filter((g) => g.type === "call" || g.type === "exports");
	const callOut = runCalls(workspace, callGates.map((g) => ({ type: g.type, module: g.module, fn: g.fn, args: g.args ?? [] })));
	callGates.forEach((g, i) => {
		const r = callOut[i];
		if (!r.ok) return add(g, false, r.error);
		if (g.type === "exports") return add(g, r.value === true, r.value ? `${g.fn} is exported` : `${g.fn} is not exported`);
		const got = JSON.stringify(r.value);
		const want = JSON.stringify(g.expect === undefined ? "__undefined__" : g.expect);
		add(g, got === want, got === want ? `= ${want}` : `got ${got}, want ${want}`);
	});

	const answer = answerFile !== undefined ? readOr(answerFile) : null;
	const tasks = JSON.parse(readFileSync(join(instanceDir, "tasks.json"), "utf8"));
	for (const g of spec.gates) {
		switch (g.type) {
			case "call":
			case "exports":
				break;
			case "body-differs": {
				const before = extractBlock(readOr(join(pristineRoot, g.file)) ?? "", g.fn);
				const after = extractBlock(readOr(join(workspace, g.file)) ?? "", g.fn);
				if (before === null) add(g, false, `the generator's own marker is missing from the pristine copy: ${g.fn}`);
				else if (after === null) add(g, false, `not found in the workspace: ${g.fn}`);
				else add(g, before !== after, before !== after ? "the body changed" : "the body is byte-identical to the pristine fixture");
				break;
			}
			case "line-once": {
				const text = readOr(join(workspace, g.file)) ?? "";
				// review G7: a list-writing arm writes "- added X" — the line is the
				// same fact with a bullet; a doubled bullet is still doubled
				const re = new RegExp(`^\\s*(?:[-*]\\s+)?${escapeRe(g.line)}\\s*$`);
				const n = text.split("\n").filter((l) => re.test(l)).length;
				add(g, n === 1, `${n} occurrence(s)`);
				break;
			}
			case "defined-once": {
				const text = readOr(join(workspace, g.file)) ?? "";
				const n = (text.match(new RegExp(`(function\\s+${escapeRe(g.fn)}\\s*\\(|(const|let|var)\\s+${escapeRe(g.fn)}\\s*=)`, "g")) ?? []).length;
				add(g, n === 1, `${n} definition(s)`);
				break;
			}
			case "test-against": {
				const test = readOr(join(workspace, g.testFile));
				if (test === null) {
					add(g, false, `${g.testFile} is missing`);
					break;
				}
				const dir = mkdtempSync(join(tmpdir(), "kiso-concealed-ref-"));
				try {
					mkdirSync(join(dir, "src"), { recursive: true });
					mkdirSync(join(dir, "tests"), { recursive: true });
					writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
					writeFileSync(join(dir, g.module), `export ${g.implementation}\n`);
					writeFileSync(join(dir, g.testFile), test);
					// A `node --test` run INSIDE another test runner inherits its
					// NODE_TEST_CONTEXT and then reports to the parent instead of
					// setting its own exit code — a failing test would read as a
					// pass. The verdict must not depend on who called verify.
					const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;
					const r = spawnSync(process.execPath, ["--test", g.testFile], { cwd: dir, encoding: "utf8", timeout: CALL_TIMEOUT_MS, env });
					const passed = r.status === 0;
					// B+D-1: passes against the reference; B+D-1b: FAILS against the
					// defective variant — a test that no longer asserts anything
					// passes both implementations and fails here
					add(g, passed === g.expectPass, g.expectPass ? (passed ? "the repaired test passes against the reference implementation" : `the repaired test fails against the reference (exit ${r.status})`) : passed ? "the test passes against the DEFECTIVE variant — it no longer asserts the documented behaviour" : "the test still catches the defective variant");
				} finally {
					rmSync(dir, { recursive: true, force: true });
				}
				break;
			}
			case "answer": {
				if (answer === null) add(g, false, "no answer file was supplied");
				else add(g, answerHas(answer, g.expect, tasks[0] ?? ""), `expected ${JSON.stringify(g.expect)} as the answer's one stated value`);
				break;
			}
			case "answer-machine": {
				const truth = execFileSync(g.command[0], g.command.slice(1), { encoding: "utf8" }).trim();
				if (answer === null) add(g, false, "no answer file was supplied");
				else add(g, answerHas(answer, truth, tasks[0] ?? ""), `expected ${JSON.stringify(truth)} (measured now, on this machine) as the answer's one stated value`);
				break;
			}
			default:
				add(g, false, `unknown gate type ${g.type}`);
		}
	}

	// reports — data, never the verdict
	const reports = [];
	const before = new Set(listFiles(pristineRoot));
	const after = new Set(listFiles(workspace));
	const modified = [...after].filter((f) => before.has(f) && readFileSync(join(pristineRoot, f), "utf8") !== readFileSync(join(workspace, f), "utf8"));
	const changed = { added: [...after].filter((f) => !before.has(f)), modified, deleted: [...before].filter((f) => !after.has(f)) };
	for (const r of spec.reports) {
		if (r.type === "changed-files") reports.push({ id: r.id, class: "REPORTED", value: changed });
		else if (r.type === "file-touched") reports.push({ id: r.id, class: "REPORTED", value: { file: r.file, touched: changed.modified.includes(r.file) || changed.deleted.includes(r.file) } });
		else if (r.type === "measured") reports.push({ id: r.id, class: "REPORTED", value: null, from: r.from });
		else if (r.type === "record-at-kill") reports.push({ id: r.id, class: "REPORTED", value: null, turn: r.turn, from: "the arm's own session record, read by the runner" });
	}

	const verdict = results.filter((r) => r.class === "GATE").every((r) => r.pass) ? "pass" : "fail";
	const body = { verdict, instance: meta.id, family: meta.family, favours: meta.favours, shapeHash: meta.shapeHash, gates: results, reports };
	if (outDir !== undefined) {
		mkdirSync(outDir, { recursive: true });
		writeFileSync(join(outDir, "verify.json"), `${JSON.stringify(body, null, 2)}\n`, "utf8");
	}
	return body;
}
