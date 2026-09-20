#!/usr/bin/env node
/**
 * R-D 0.1.45 (deliverable D): the tracked tree stays CJK-free.
 *
 * The englishization ruling (2026-08-06) makes English the only prose
 * language of the tree. README.zh.md is the ONE sanctioned exception —
 * the Chinese edition of the README, named exactly. Any other CJK
 * character in a tracked file fails the process with the file and line
 * named, before it can be committed.
 *
 * Runs as part of `npm run check`, right beside the whitespace gate.
 * Scans the WORKING TREE's tracked files (git ls-files) — a CJK
 * character written today is caught today, not at the next commit.
 *
 * The character range is the ruling's own: U+4E00..U+9FFF (the CJK
 * unified ideographs block — the historical `git grep -P
 * '[\x{4e00}-\x{9fff}]'` check, now enforced instead of relied on).
 *
 * Zero dependencies: this must run in CI before any install step.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { declaredBinary } from "./declared-binary.mjs";

/** The single-file exemption: the Chinese README edition. */
const EXEMPT = new Set(["README.zh.md"]);

/** The ONE phrase allowed outside that file: the link label README.md
 *  points at it with, which the owner ruled (2026-09-20) must read as the
 *  language names itself rather than in English. It is an allowance for
 *  THIS EXACT STRING in THIS ONE FILE — every other CJK character in
 *  README.md is still a failure, and no other file has an allowance. */
const ALLOWED = new Map([["README.md", ["\u7b80\u4f53\u4e2d\u6587"]]]);

const listed = execSync("git ls-files", { encoding: "utf8" })
	.split("\n")
	.filter((f) => f !== "" && !EXEMPT.has(f) && !f.includes("node_modules") && !f.endsWith(".d.ts"));
// A path .gitattributes marks -text is not text; arbitrary bytes decode
// into the CJK block often enough that any binary would trip this.
const binaryPaths = declaredBinary(listed);
const tracked = listed.filter((f) => !binaryPaths.has(f));

// U+4E00..U+9FFF via escapes — the gate's own source stays
// CJK-free and never trips the check it enforces.
const CJK = /[\u4e00-\u9fff]/;
const problems = [];
for (const file of tracked) {
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		continue; // a gitlink or unreadable entry
	}
	const allowed = ALLOWED.get(file) ?? [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		for (const phrase of allowed) line = line.split(phrase).join("");
		if (CJK.test(line)) {
			problems.push(`${file}:${i + 1}: CJK — the tracked tree is English (README.zh.md is the only exception)`);
		}
	}
}

if (problems.length > 0) {
	console.error("[check-cjk] FAIL:");
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log(`[check-cjk] OK — ${tracked.length} tracked files CJK-free (README.zh.md exempt)`);
