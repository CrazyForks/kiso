/**
 * Write one instance to a directory the existing runners consume.
 *
 *   DIR/fixture/          the tree the runner copies into the leg (cp -R)
 *   DIR/tasks.json        the turn prompts — the array shape run-t5/t6 read
 *   DIR/verifier/         HELD OUT — never copied into a workspace:
 *     spec.json             the generated gates and reports, each citing
 *     pristine/             the fixture as generated, for the byte
 *                           comparisons and the changed-file report
 *     solution.json         the reference solution (self-check's positive)
 *     controls.json         negative controls, each with the gate it must
 *                           fail on (B+D: a compensation at the caller, a
 *                           gutted test, a bent function)
 *   DIR/instance.json     id, family, the favours label, params, the shape
 *                         hash, the request estimate, and F's kill spec
 *
 * Refuses a non-empty DIR: a materialisation that merged into an old one
 * would verify against a mixture.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function writeTree(root, files) {
	for (const [rel, text] of Object.entries(files)) {
		const p = join(root, rel);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, text, "utf8");
	}
}

export function materialize(instance, dir) {
	if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`materialize: ${dir} is not empty`);
	mkdirSync(dir, { recursive: true });
	writeTree(join(dir, "fixture"), instance.files);
	writeTree(join(dir, "verifier", "pristine"), instance.files);
	writeFileSync(join(dir, "tasks.json"), `${JSON.stringify(instance.tasks, null, 2)}\n`, "utf8");
	writeFileSync(join(dir, "verifier", "spec.json"), `${JSON.stringify(instance.spec, null, 2)}\n`, "utf8");
	// held out with the verifier: the reference solution and the negative
	// controls self-check applies to prove the verifier passes a correct
	// workspace and fails each named wrong one on the gate it names
	writeFileSync(join(dir, "verifier", "solution.json"), `${JSON.stringify(instance.solution, null, 2)}\n`, "utf8");
	writeFileSync(join(dir, "verifier", "controls.json"), `${JSON.stringify(instance.controls ?? [], null, 2)}\n`, "utf8");
	const meta = {
		id: instance.id,
		family: instance.family,
		favours: instance.favours,
		shapeHash: instance.shapeHash,
		apparatusHash: instance.apparatusHash,
		params: instance.params,
		turns: instance.tasks.length,
		estRequests: instance.estRequests,
		required: instance.required,
		...(instance.kill !== undefined ? { kill: instance.kill, restart: instance.restart } : {}),
	};
	writeFileSync(join(dir, "instance.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
	return meta;
}
