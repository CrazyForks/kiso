/**
 * Prove each instance's verifier before any scored leg depends on it.
 *
 * For one materialised instance, three workspaces:
 *   the untouched fixture           → must FAIL (a task already done is no task)
 *   the reference solution applied  → must PASS (a verifier that fails the
 *                                     right answer is measuring itself)
 *   B+D's compensation applied      → must FAIL, and on B+D-3 — the work-
 *                                     around where the failure surfaced
 *
 * The runner can run this at materialisation, inside the ceremony, on the
 * real seed — it reads nothing the tuning side is not allowed to see,
 * because it prints verdicts and assertion ids, never instance content.
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
			if (!before.includes(from)) throw new Error(`self-check: the edit's anchor is not in ${e.file}`);
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

export function selfCheck(instanceDir) {
	const meta = JSON.parse(readFileSync(join(instanceDir, "instance.json"), "utf8"));
	const solution = JSON.parse(readFileSync(join(instanceDir, "verifier", "solution.json"), "utf8"));
	const scratch = mkdtempSync(join(tmpdir(), "kiso-concealed-self-"));
	const problems = [];
	const cleanup = [scratch];
	try {
		// 1. the untouched fixture
		const pristine = workspaceFrom(instanceDir);
		cleanup.push(pristine);
		const emptyAnswer = join(scratch, "empty-answer.txt");
		writeFileSync(emptyAnswer, "\n");
		const p = verify({ instanceDir, workspace: pristine, answerFile: emptyAnswer });
		if (p.verdict !== "fail") problems.push("the untouched fixture PASSES — the task is already done");
		// 2. the reference solution
		const solved = workspaceFrom(instanceDir);
		cleanup.push(solved);
		applyEdits(solved, solution.edits);
		const answer = join(scratch, "answer.txt");
		const text = solution.answer === undefined ? "" : solution.answer.text ?? `The answer is ${execFileSync(solution.answer.command[0], solution.answer.command.slice(1), { encoding: "utf8" }).trim()}.`;
		writeFileSync(answer, `${text}\n`);
		const s = verify({ instanceDir, workspace: solved, answerFile: answer });
		if (s.verdict !== "pass") problems.push(`the reference solution FAILS: ${s.gates.filter((g) => g.class === "GATE" && !g.pass).map((g) => g.id).join(", ")}`);
		// 3. B+D's compensation
		let compensation = null;
		try {
			compensation = JSON.parse(readFileSync(join(instanceDir, "verifier", "compensation.json"), "utf8"));
		} catch {
			// no compensation for this family or location
		}
		if (compensation !== null) {
			const comp = workspaceFrom(instanceDir);
			cleanup.push(comp);
			applyEdits(comp, compensation.edits);
			const c = verify({ instanceDir, workspace: comp, answerFile: answer });
			const b3 = c.gates.find((g) => g.id === "B+D-3");
			if (c.verdict !== "fail") problems.push("the compensating change PASSES");
			else if (b3 === undefined || b3.pass) problems.push("the compensating change fails, but not on B+D-3");
		}
	} finally {
		for (const d of cleanup) rmSync(d, { recursive: true, force: true });
	}
	return { id: meta.id, family: meta.family, ok: problems.length === 0, problems };
}
