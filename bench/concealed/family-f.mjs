/**
 * Family F — the interrupted session.
 *
 * A family-A instance, killed mid-run, restarted. It exists because the
 * launch bench scores an interruption-and-recovery axis and a concealed
 * set without an interruption family leaves that axis scored on seen tasks
 * only.
 *
 * LABELLED: F favours OUR DESIGN — durable receipts, a recorded verdict
 * per execution. It is the property we claim in the README.
 *
 * WHICH IS EXACTLY WHY ITS VERIFIER MUST BE ABLE TO FAIL US. A family that
 * can only confirm what we already say is decoration. So the assertions
 * are written against the WORLD, not against our records:
 *
 *   F-1  the final state is family A's — the same generated verifier
 *   F-2  NO EFFECT IS APPLIED TWICE — checked in the workspace, by a
 *        counter the task increments, not by reading our own log
 *   F-3  the session's record says what it did and did not know at the
 *        kill — and F-3 is REPORTED, never gated, because it is the one
 *        assertion that reads our own claim back to us
 *
 * F-2 is the falsifier. If a restart re-applies an effect, the counter
 * says so no matter what any receipt claims.
 */
import { generateA, verifierA } from "./family-a.mjs";

export function generateF(g, { turns = 6 } = {}) {
	const base = generateA(g, { turns });
	// the kill lands inside the work, never on the first or last turn: both
	// ends are special cases that test the harness rather than the product
	const killTurn = 2 + g.int(Math.max(1, turns - 3));
	// BEFORE or AFTER the effect is recorded — the two sides of the only
	// question a recovery design has to answer
	const killWhen = g.pick(["before the effect is recorded", "after the effect is recorded"]);

	// the counted effect: an append-only ledger the task writes to once per
	// turn. A re-applied effect appears as a duplicate line, in the world.
	const ledgerTurn = killTurn;
	const stamp = `F-${g.int(1e6).toString(36)}`;
	const turnsWithEffect = base.turns.map((t, i) =>
		i + 1 === ledgerTurn
			? `${t} Then append the single line "${stamp}-${i + 1}" to ledger.txt (create it if absent).`
			: t);

	return {
		family: "F",
		favours: "ours, by design — durable receipts; which is why F-2 is written to be able to fail us",
		turns: turnsWithEffect,
		contracts: base.contracts,
		kill: { turn: killTurn, when: killWhen },
		effect: { file: "ledger.txt", line: `${stamp}-${ledgerTurn}` },
	};
}

/** F's verifier: family A's, plus the world-side duplicate check. */
export function verifierF(inst) {
	const a = verifierA(inst);
	const extra = [
		"",
		"// F-2 — THE FALSIFIER. A restart that re-applies an effect shows up",
		"// here as a duplicate line, in the workspace, whatever any receipt of",
		"// ours may say about it. This assertion is not allowed to consult our",
		"// own records, because its whole job is to be able to contradict them.",
		'import { readFileSync, existsSync } from "node:fs";',
		`const ledger = existsSync("ledger.txt") ? readFileSync("ledger.txt", "utf8").split("\\n").filter(Boolean) : [];`,
		`const hits = ledger.filter((l) => l.trim() === ${JSON.stringify(inst.effect.line)});`,
		`assert.strictEqual(hits.length, 1, ${JSON.stringify(`the effect ${inst.effect.line} must appear exactly once — ${"" }a restart may not re-apply it`)});`,
	];
	return a.replace('console.log("ok");', extra.join("\n") + '\nconsole.log("ok");');
}
