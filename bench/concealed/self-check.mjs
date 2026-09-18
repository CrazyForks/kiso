/**
 * Prove each instance's verifier before any scored leg depends on it.
 *
 * For one materialised instance:
 *   the untouched fixture           → must FAIL (a task already done is no task)
 *   the reference solution applied  → must PASS (a verifier that fails the
 *                                     right answer is measuring itself)
 *   each negative control           → must FAIL, on the gate it names
 *                                     (B+D: a compensation at the caller on
 *                                     B+D-3; a gutted test on B+D-1b; a
 *                                     bent function on B+D-2)
 *
 * The ceremony runs this on the REAL seed, so what it returns for a person
 * to read is instance-free: problems are described by gate TYPE and COUNT
 * (review G5). Gate ids — which carry drawn names — are returned only when
 * the caller asks for them (`verbose`), which the ceremony never does.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "./verify.mjs";

function applyEdits(ws, edits) {
	for (const e of edits) {
		const p = join(ws, e.file);
		const before = readFileSync(p, "utf8");
		let after;
		if (e.append !== undefined) after = before + e.append;
		else {
			const [from, to] = e.replace;
			if (!before.includes(from)) throw new Error("self-check: an edit's anchor is missing from its file");
			after = before.replace(from, to);
		}
		writeFileSync(p, after, "utf8");
	}
}

function workspaceFrom(instanceDir) {
	const ws = mkdtempSync(join(tmpdir(), "kiso-concealed-ws-"));
	cpSync(join(instanceDir, "fixture"), ws, { recursive: true });
	return ws;
}

/** "call ×3, line-once ×1" — types and counts, never ids. */
function byType(gates) {
	const n = new Map();
	for (const g of gates) n.set(g.type, (n.get(g.type) ?? 0) + 1);
	return [...n].map(([t, k]) => `${t} ×${k}`).join(", ");
}

export function selfCheck(instanceDir, { verbose = false } = {}) {
	const meta = JSON.parse(readFileSync(join(instanceDir, "instance.json"), "utf8"));
	const solution = JSON.parse(readFileSync(join(instanceDir, "verifier", "solution.json"), "utf8"));
	const controls = JSON.parse(readFileSync(join(instanceDir, "verifier", "controls.json"), "utf8"));
	const cleanup = [];
	const problems = [];
	const detail = [];
	const failedGates = (r) => r.gates.filter((g) => g.class === "GATE" && !g.pass);
	try {
		const scratch = mkdtempSync(join(tmpdir(), "kiso-concealed-self-"));
		cleanup.push(scratch);
		const emptyAnswer = join(scratch, "empty-answer.txt");
		writeFileSync(emptyAnswer, "\n");
		// 1. the untouched fixture
		const pristine = workspaceFrom(instanceDir);
		cleanup.push(pristine);
		const p = verify({ instanceDir, workspace: pristine, answerFile: emptyAnswer });
		if (p.verdict !== "fail") problems.push("the untouched fixture passes");
		// 2. the reference solution
		const solved = workspaceFrom(instanceDir);
		cleanup.push(solved);
		applyEdits(solved, solution.edits);
		const answer = join(scratch, "answer.txt");
		const text = solution.answer === undefined ? "" : solution.answer.text ?? `The answer is ${execFileSync(solution.answer.command[0], solution.answer.command.slice(1), { encoding: "utf8" }).trim()}.`;
		writeFileSync(answer, `${text}\n`);
		const s = verify({ instanceDir, workspace: solved, answerFile: answer });
		if (s.verdict !== "pass") {
			problems.push(`the reference solution fails (${byType(failedGates(s))})`);
			if (verbose) detail.push(...failedGates(s).map((g) => g.id));
		}
		// 3. the negative controls
		controls.forEach((c, i) => {
			const ws = workspaceFrom(instanceDir);
			cleanup.push(ws);
			applyEdits(ws, c.edits);
			const r = verify({ instanceDir, workspace: ws, answerFile: answer });
			const on = failedGates(r).filter((g) => g.id === c.mustFailOn || g.id.startsWith(`${c.mustFailOn}:`) || g.id.startsWith(`${c.mustFailOn}#`));
			if (r.verdict !== "fail") problems.push(`negative control ${i + 1} (${c.name}) passes`);
			else if (on.length === 0) problems.push(`negative control ${i + 1} (${c.name}) fails, but not on the gate it names`);
		});
	} finally {
		for (const d of cleanup) rmSync(d, { recursive: true, force: true });
	}
	return { id: meta.id, family: meta.family, ok: problems.length === 0, problems, ...(verbose ? { detail } : {}) };
}
