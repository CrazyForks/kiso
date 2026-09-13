#!/usr/bin/env node
/**
 * The CTX fixture's ground truth: every top-level `export function` in the
 * snapshot, with the line it starts on and the line its body closes on.
 *
 * The END LINE is the point. A start line is greppable, so a task asking only
 * for names and start lines can be answered with one search_text and never
 * read a file — and a fixture the agent can answer without filling its
 * context cannot test a context policy. The closing brace sits arbitrarily
 * far from the signature, so producing it requires the file.
 *
 * The rule is exact, not heuristic-with-a-shrug: a body opened by a line
 * beginning `export function ` closes at the next line that is exactly `}`.
 * This codebase indents with tabs and declares these at column 0, so a `}` at
 * column 0 between them would be a syntax error. `assertRule` below proves
 * the rule holds over the whole snapshot rather than assuming it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isMain } from "../scripts/is-main.mjs";

export function walk(root) {
	const out = [];
	const visit = (d) => {
		for (const e of readdirSync(d).sort()) {
			const p = join(d, e);
			if (statSync(p).isDirectory()) visit(p);
			else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) out.push(p);
		}
	};
	visit(root);
	return out;
}

export function truthFor(root) {
	const rows = [];
	for (const p of walk(root)) {
		const lines = readFileSync(p, "utf8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (!lines[i].startsWith("export function ")) continue;
			const name = lines[i].slice("export function ".length).match(/^[A-Za-z0-9_$]+/)?.[0];
			if (name === undefined) continue;
			let end = -1;
			for (let j = i + 1; j < lines.length; j++) {
				if (lines[j] === "}") { end = j + 1; break; }
			}
			rows.push({ file: relative(root, p), name, start: i + 1, end });
		}
	}
	return rows.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
}

/** The rule must hold for EVERY row, or the fixture has no ground truth. */
export function assertRule(rows) {
	const bad = rows.filter((r) => r.end <= r.start);
	if (bad.length > 0) {
		throw new Error(`no closing line found for ${bad.length} function(s): ` +
			bad.slice(0, 3).map((b) => `${b.file}:${b.start} ${b.name}`).join(", "));
	}
	return rows;
}

if (isMain(import.meta.url)) {
	const root = process.argv[2];
	if (root === undefined) { console.error("usage: ctx-truth.mjs <src-root>"); process.exit(2); }
	const rows = assertRule(truthFor(root));
	console.log(JSON.stringify(rows, null, 1));
}
