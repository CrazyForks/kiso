/**
 * The shape is committed BEFORE any seed exists (review ruling 4).
 *
 * The pin is SHAPE_HASH beside this directory: sha256 over every file under
 * shape/. Changing the shape without changing the pin is red — the shape the
 * owner's seed is drawn against is the one in this commit, and a later edit
 * cannot quietly become the shape the scored legs ran on.
 *
 * Throwaway seeds only. The real seed is drawn by the owner at the freeze
 * and never typed by the tuning side.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apparatusHash, shapeHash, generateAll, generateInstance, instanceIds } from "../generate.mjs";
import { DOC_CITED_GATES, FAVOURS, bdPromptSpace } from "../shape/families.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the shape hash is pinned: a shape edit without a new pin is red", () => {
	const pinned = readFileSync(join(HERE, "..", "SHAPE_HASH"), "utf8").trim();
	assert.equal(shapeHash(), pinned, "the shape changed — review it, then re-pin SHAPE_HASH in the same commit");
});

test("the apparatus hash is pinned: the verifier's semantics cannot move under a pinned shape (review G4)", () => {
	const pinned = readFileSync(join(HERE, "..", "APPARATUS_HASH"), "utf8").trim();
	assert.equal(apparatusHash(), pinned, "verify/generate/materialize/self-check/check-shape/cli changed — review, then re-pin APPARATUS_HASH");
});

test("B+D states its true, small space — computed from the pool, never 'too large to enumerate' (review G2)", () => {
	const b = bdPromptSpace();
	assert.ok(b.functions >= 8, `B+D has ${b.functions} defectable functions — the review asked for at least 8`);
	assert.equal(b.triples, b.functionKindPairs * 3);
	assert.ok(b.prompts > 51, `B+D has only ${b.prompts} distinct prompts`);
	const readme = readFileSync(join(HERE, "..", "README.md"), "utf8");
	assert.ok(readme.includes(`${b.prompts} distinct prompts`), "the README states B+D's true prompt count");
	assert.doesNotMatch(readme.split("## The rules")[0], /B\+D[^\n]*too large to enumerate/);
});

test("B+D's symptom is DRAWN — not fixed per function (review G2)", () => {
	const prompts = new Set();
	for (let s = 0; s < 60; s += 1) for (const i of generateAll(`throwaway-bd-space-${s}`)) if (i.family === "BD") prompts.add(i.tasks[0]);
	assert.ok(prompts.size > 51, `only ${prompts.size} distinct B+D prompts over 360 draws`);
});

test("an instance is a pure function of (shape, seed, family, index)", () => {
	const a = JSON.stringify(generateAll("throwaway-determinism"));
	const b = JSON.stringify(generateAll("throwaway-determinism"));
	assert.equal(a, b);
	assert.notEqual(JSON.stringify(generateAll("throwaway-other")), a, "two seeds drew the same set");
	// one family's draws never shift another's: A-3 is the same whatever else is drawn
	assert.equal(JSON.stringify(generateInstance("throwaway-x", "A-3")), JSON.stringify(generateAll("throwaway-x").find((i) => i.id === "A-3")));
});

test("every gate cites a verbatim clause of the turn it names (the citation rule)", () => {
	for (const seed of ["throwaway-cite-1", "throwaway-cite-2", "throwaway-cite-3"]) {
		for (const inst of generateAll(seed)) {
			for (const g of inst.spec.gates) {
				assert.ok(g.cite, `${inst.id} ${g.id} carries no citation`);
				// the declared exception (review S2): exactly these two B+D gates
				// cite the ruled verifier doc, because the task's words state what
				// should be returned, not where the repair lands
				if (g.cite.doc !== undefined) {
					assert.ok(DOC_CITED_GATES.includes(g.id), `${inst.id} ${g.id} cites a doc — only ${DOC_CITED_GATES.join(", ")} may`);
					assert.match(g.cite.doc, /concealed-set-bd-verifier/);
					continue;
				}
				const turn = inst.tasks[g.cite.turn - 1];
				assert.ok(turn !== undefined, `${inst.id} ${g.id} cites turn ${g.cite.turn}, which does not exist`);
				assert.ok(turn.includes(g.cite.clause), `${inst.id} ${g.id}: "${g.cite.clause}" is not in turn ${g.cite.turn}`);
			}
		}
	}
});

test("each instance carries its family's favours label, verbatim from the review", () => {
	const review = { A: "ours by history", BD: "neither", C: "ours by tuning", E: "theirs by design", F: "ours by design" };
	assert.deepEqual(FAVOURS, review);
	for (const inst of generateAll("throwaway-favours")) assert.equal(inst.favours, review[inst.family]);
});

test("the instance list is five families of six", () => {
	const ids = instanceIds();
	assert.equal(ids.length, 30);
	for (const fam of ["A", "BD", "C", "E", "F"]) assert.equal(ids.filter((i) => i.startsWith(`${fam}-`)).length, 6);
});
