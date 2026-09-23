/**
 * CS-1 (0.40.7) — a delegate evaluator runs only when the USER listed it.
 *
 * A `delegate` task's `acceptance: { evaluator }` used to accept any existing
 * absolute path outside the project. The MODEL writes the task, so the path
 * could be an interpreter — `/usr/bin/python3 <worktree>` runs the
 * `__main__.py` the child wrote, in the parent, outside the shell tool and
 * everything that reads shell lines. Now the path must be one the user
 * listed in the config's `evaluators` (compared by real path). The tool's
 * description is unchanged: the task still names an absolute path.
 */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateTask } from "../dist/kiso-subagent.mjs";

function setup(): { project: string; manifest: string; script: string; other: string } {
	const root = mkdtempSync(join(tmpdir(), "kiso-cs1-"));
	const project = join(root, "project");
	const manifest = join(root, "manifest");
	mkdirSync(project);
	mkdirSync(manifest);
	const script = join(root, "evaluate.sh");
	writeFileSync(script, "#!/bin/sh\nexit 0\n");
	chmodSync(script, 0o755);
	const other = join(root, "other.sh");
	writeFileSync(other, "#!/bin/sh\nexit 0\n");
	chmodSync(other, 0o755);
	return { project, manifest, script, other };
}
const task = (evaluator: string) => ({ role: "implementer", task: "do it", acceptance: { evaluator } });

describe("CS-1: the evaluator allowlist", () => {
	it("an interpreter the model names is refused — nothing listed, or something else listed", () => {
		const { project, manifest, script } = setup();
		for (const evaluators of [[], [script]]) {
			const why = validateTask(task(process.execPath), { checks: {}, evaluators, profiles: [] }, project, manifest);
			expect(why, JSON.stringify(evaluators)).toMatch(/is not a configured evaluator/);
		}
		expect(validateTask(task(process.execPath), { checks: {}, profiles: [] }, project, manifest), "no evaluators key at all").toMatch(/is not a configured evaluator.*configured: none/);
	});
	it("a listed script is accepted; another script beside it is not", () => {
		const { project, manifest, script, other } = setup();
		const cfg = { checks: {}, evaluators: [script], profiles: [] };
		expect(validateTask(task(script), cfg, project, manifest)).toBeNull();
		expect(validateTask(task(other), cfg, project, manifest)).toMatch(/is not a configured evaluator/);
	});
	it("compared by real path: a symlink to the listed script is the listed script; a symlink to an interpreter is not", () => {
		const { project, manifest, script } = setup();
		const dir = mkdtempSync(join(tmpdir(), "kiso-cs1-links-"));
		const toScript = join(dir, "eval-link");
		symlinkSync(script, toScript);
		const toInterpreter = join(dir, "python-link");
		symlinkSync(process.execPath, toInterpreter);
		const cfg = { checks: {}, evaluators: [script], profiles: [] };
		expect(validateTask(task(toScript), cfg, project, manifest)).toBeNull();
		expect(validateTask(task(toInterpreter), cfg, project, manifest)).toMatch(/is not a configured evaluator/);
	});
	it("the older rules still hold first: inside the project is refused even when listed", () => {
		const { project, manifest } = setup();
		const inside = join(project, "evaluate.sh");
		writeFileSync(inside, "#!/bin/sh\nexit 0\n");
		chmodSync(inside, 0o755);
		expect(validateTask(task(inside), { checks: {}, evaluators: [inside], profiles: [] }, project, manifest)).toMatch(/OUTSIDE the project/);
	});
});
