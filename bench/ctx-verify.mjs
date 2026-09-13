#!/usr/bin/env node
/**
 * The CTX fixture's acceptance, over the WHOLE deliverable.
 *
 * The first version compared one set — (file, name, start, end) — and called
 * the result pass or fail. Three things were wrong with that:
 *
 *  - It scored a task it did not check. The turn also asks for longest.md,
 *    and nothing looked at it. A leg that never wrote it could still be
 *    called a pass on the strength of answers.json alone.
 *  - It read a SET, so a file listing the same function twice looked
 *    identical to one listing it once.
 *  - It collapsed two failures with opposite meanings into one word. One
 *    leg wrote all 147 entries with a single end line off by fifteen; another
 *    wrote 124 and stopped. As "fail" they are the same, and the cheaper one
 *    is cheaper BECAUSE it did less — which is how an incomplete leg gets
 *    read as an efficiency win.
 *
 * So coverage and exactness are reported separately. `complete` is how much
 * of the task exists; `exact` is whether what exists is right. Only a leg
 * that is complete can have its cost compared to another leg's, and that is
 * a property of the run, not of the arm.
 *
 * The ground truth is recomputed from the PRISTINE fixture, never from the
 * workspace: the agent can edit the workspace's sources, and a verifier that
 * derives its expectations from a tree the subject can move is not one.
 *
 * The purpose sentences are deliberately NOT scored. They exist so that a
 * shell one-liner cannot answer the task, which is what keeps the reads —
 * and therefore the context — real. Their presence is reported; their
 * meaning is not judged, and no verdict here rests on them.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { truthFor, assertRule } from "./ctx-truth.mjs";
import { isMain } from "../scripts/is-main.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function verify(work, fixtureSrc = join(HERE, "fixture-ctx", "src")) {
	const truth = assertRule(truthFor(fixtureSrc));
	const key = (r) => `${r.file}|${r.name}|${r.start}|${r.end}`;
	const ident = (r) => `${r.file}|${r.name}`;

	const out = {
		expected: truth.length,
		answersPresent: false, entries: 0, duplicates: 0,
		covered: 0, exactRows: 0, wrongLines: 0, extra: 0,
		purposeNonEmpty: 0,
		longestPresent: false, longestCorrect: false,
		complete: false, exact: false,
	};

	const answers = join(work, "answers.json");
	if (!existsSync(answers)) return out;
	let got;
	try { got = JSON.parse(readFileSync(answers, "utf8")); } catch { return out; }
	if (!Array.isArray(got)) return out;
	out.answersPresent = true;
	const rows = got.filter((r) => r !== null && typeof r === "object");
	out.entries = rows.length;

	const seen = new Map();
	for (const r of rows) seen.set(ident(r), (seen.get(ident(r)) ?? 0) + 1);
	out.duplicates = [...seen.values()].filter((n) => n > 1).length;

	const wantIdent = new Set(truth.map(ident));
	const wantKey = new Set(truth.map(key));
	const haveIdent = new Set(rows.map(ident));
	const haveKey = new Set(rows.map(key));

	out.covered = [...wantIdent].filter((i) => haveIdent.has(i)).length;
	out.exactRows = [...wantKey].filter((k) => haveKey.has(k)).length;
	out.wrongLines = out.covered - out.exactRows;
	out.extra = [...haveIdent].filter((i) => !wantIdent.has(i)).length;
	out.purposeNonEmpty = rows.filter((r) => typeof r.purpose === "string" && r.purpose.trim() !== "").length;

	// COVERAGE is the task existing; EXACTNESS is it being right.
	out.complete = out.covered === truth.length && out.extra === 0 && out.duplicates === 0;
	out.exact = out.exactRows === truth.length && out.extra === 0 && out.duplicates === 0;

	// The second deliverable, which nothing used to look at.
	const longest = join(work, "longest.md");
	if (existsSync(longest)) {
		out.longestPresent = true;
		const text = readFileSync(longest, "utf8");
		const ranked = [...truth].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 3);
		out.longestCorrect = ranked.every((r) => text.includes(r.name));
	}
	return out;
}

if (isMain(import.meta.url)) {
	const work = process.argv[2];
	if (work === undefined) { console.error("usage: ctx-verify.mjs <workdir>"); process.exit(2); }
	const r = verify(work);
	if (process.argv[3] === "--json") console.log(JSON.stringify(r, null, 1));
	else console.log(r.complete && r.exact && r.longestCorrect ? "pass" : "fail");
}
