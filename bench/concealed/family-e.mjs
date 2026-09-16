/**
 * Family E — the simple request, answered by doing.
 *
 * ONE turn. A question that a single command or a small read answers.
 *
 * LABELLED: this family favours THE OTHER ARM'S DESIGN — fewer, larger
 * steps. It is in the set because without it the set measures only what we
 * are good at, and that is the reviewer's ruling, not my preference. I
 * would not have chosen it.
 *
 * DISCRIMINATES: directness. Three numbers per instance, and only the
 * first is a pass/fail —
 *   correctness  the answer contains the planted token
 *   reach        did it answer at all, or decline / ask instead
 *   cost         requests and tool calls spent getting there
 *
 * THE VERIFICATION MODE IS DIFFERENT FROM FAMILY A's and the harness does
 * not have it yet: A checks the WORKSPACE by running generated tests; E
 * must check what the agent SAID. The token is generated, so the check is
 * generated with it and ruling 3 holds — but the runner needs a
 * transcript-reading verifier before E can run. Stated here rather than
 * discovered at freeze time.
 *
 * NO TRICK QUESTIONS, AND NO LUCK. Every instance is answerable by one
 * obvious action, and every expected answer carries a planted token — an
 * arm that answers without looking cannot be right by chance, and an arm
 * that looks is never wrong. The count shape had to be repaired for this:
 * its first version asked only for a small integer, which is one guess in
 * nine.
 */

/** A token no model can produce without looking. */
function token(g) {
	const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	return Array.from({ length: 10 }, () => alpha[g.int(alpha.length)]).join("");
}

const SHAPES = [
	{
		id: "value-in-a-config",
		favours: "neither — one read answers it",
		build: (g, tok) => ({
			files: { "config/app.json": JSON.stringify({ name: "svc", release: tok, retries: 3 }, null, 2) + "\n" },
			ask: `What is the release string in config/app.json? Answer with the string itself and nothing else.`,
			expect: tok,
		}),
	},
	{
		id: "count-of-a-thing",
		favours: "theirs — one shell command answers it; a file-by-file read does too, and costs more",
		build: (g, tok) => {
			// A COUNT IS GUESSABLE AND A TOKEN IS NOT. The first version asked
			// for a count in 7..15 — one guess in nine, and the family's own
			// rule is that an arm which answers without looking cannot be
			// right by luck. So the count is wide AND the answer must carry
			// the marker, which is only obtainable by reading. The one-command
			// property survives: `ls src/*.js | wc -l` plus one read, against
			// reading every file.
			const n = 23 + g.int(58);
			const files = {};
			for (let i = 0; i < n; i += 1) files[`src/mod-${i}.js`] = `export const id = ${i};\n`;
			files["NOTES.md"] = `the marker for this workspace is ${tok}\n`;
			return {
				files,
				ask: `How many .js files are under src/, and what is the marker in NOTES.md? Answer as "<count> <marker>" and nothing else.`,
				expect: `${n} ${tok}`,
			};
		},
	},
	{
		id: "line-that-mentions",
		favours: "theirs — a search answers it",
		build: (g, tok) => {
			const lines = Array.from({ length: 40 }, (_, i) => `line ${i} of the log`);
			lines[12 + g.int(20)] = `WARN threshold exceeded: code ${tok}`;
			return { files: { "logs/run.log": lines.join("\n") + "\n" }, ask: `In logs/run.log, what code follows "threshold exceeded:"? Answer with the code alone.`, expect: tok };
		},
	},
	{
		id: "what-the-command-prints",
		favours: "neither — the command is named in the question",
		build: (g, tok) => ({
			files: { "bin/report.js": `console.log(${JSON.stringify(tok)});\n` },
			ask: `Run node bin/report.js and report exactly what it prints.`,
			expect: tok,
		}),
	},
];

export function generateE(g, { shape } = {}) {
	const chosen = shape === undefined ? g.pick(SHAPES) : SHAPES[shape % SHAPES.length];
	const tok = token(g);
	const built = chosen.build(g, tok);
	return {
		family: "E",
		favours: "theirs, by design — fewer and larger steps is what this rewards",
		shape: chosen.id,
		shapeFavours: chosen.favours,
		turns: [built.ask],
		files: built.files,
		expect: built.expect,
	};
}

/**
 * E's verifier reads the agent's ANSWER, not the workspace.
 *
 * Returned as a spec rather than as code, because the runner has no
 * transcript-reading mode yet and pretending otherwise would put a family
 * in the set whose verifier cannot run.
 */
export function verifierE(inst) {
	return {
		mode: "transcript",
		needs: "the leg's final assistant text",
		assertions: [
			{ kind: "contains", value: inst.expect, cite: inst.turns[0] },
			{ kind: "reached", cite: "answered rather than declined or asked a clarifying question" },
		],
		reported: ["requests", "toolCalls", "askedAClarifyingQuestion"],
	};
}

/** How many shapes this family has — the builder's quota needs it. */
export const SHAPE_COUNT = SHAPES.length;
