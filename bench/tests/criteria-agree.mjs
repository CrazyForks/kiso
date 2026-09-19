/**
 * The frozen kit and the script that applies it must state the same
 * margins.
 *
 * A margin transcribed by hand from a kit into a script can be retyped
 * later, and the retyping looks exactly like the original — so "frozen"
 * becomes a property of my intentions rather than of the repository. This
 * reads both files and compares them.
 *
 * It lives in its own file because the first version was a node program
 * inside a shell heredoc inside a python string: the backslashes did not
 * survive three layers, every pattern silently failed to match, and the
 * gate reported the script "no longer defines" constants that were sitting
 * right there. It was red in both positions of its own red proof, which is
 * the signature of a gate that discriminates nothing.
 */
import { readFileSync } from "node:fs";

const [kitPath, jsPath, which = "edit-echo"] = process.argv.slice(2);
// The kit is prose: its sentences WRAP, and inside a blockquote each
// continuation carries a "> " prefix. Matching the raw text found the
// thresholds (one line each) and missed the sign rule (two lines), which
// then reported the kit as no longer stating something it states plainly.
// Strip the quote markers and collapse whitespace before matching.
const kit = readFileSync(kitPath, "utf8")
	.split("\n")
	.map((l) => l.replace(/^\s*>\s?/, ""))
	.join(" ")
	.replace(/\s+/g, " ");
const js = readFileSync(jsPath, "utf8");

const constOf = (name) => {
	const m = js.match(new RegExp(`const\\s+${name}\\s*=\\s*(-?[0-9.]+)`));
	return m ? Number(m[1]) : null;
};

const bad = [];
const check = (name, want, label) => {
	const got = constOf(name);
	if (want === null) bad.push(`${name}: the kit no longer states it (${label})`);
	else if (got === null) bad.push(`${name}: the script no longer defines it`);
	else if (Math.abs(got - want) > 1e-9) bad.push(`${name}: kit ${want} vs script ${got}`);
};

if (which === "edit-echo") {
	// "median(d_read) ≤ −25%" — the minus may be U+2212 or ASCII
	const read = kit.match(/median\(d_read\)\s*[≤<]=?\s*[−-]\s*([0-9.]+)\s*%/);
	check("READ_DELTA_MAX", read ? -Number(read[1]) / 100 : null, "the primary threshold");

	const cost = kit.match(/cost-weighted delta\s*[≤<]=?\s*\+([0-9.]+)\s*%/);
	check("COST_DELTA_MAX", cost ? Number(cost[1]) / 100 : null, "the cost guard");

	const wall = kit.match(/wall delta\s*[≤<]=?\s*\+([0-9.]+)\s*%/);
	check("WALL_DELTA_MAX", wall ? Number(wall[1]) / 100 : null, "the wall guard");

	const pairs = kit.match(/at least\s+(\d+)\s+of\s+\d+\s+pairs are negative/);
	check("MIN_NEGATIVE_PAIRS", pairs ? Number(pairs[1]) : null, "the sign rule");
} else {
	// round A: "median(d_reasoning) ≤ −30% AND at least 6 of 9 pairs are negative"
	const rsn = kit.match(/median\(d_reasoning\)\s*[≤<]=?\s*[−-]\s*([0-9.]+)\s*%/);
	check("REASONING_DELTA_MAX", rsn ? -Number(rsn[1]) / 100 : null, "the primary threshold");

	const pairs = kit.match(/at least\s+(\d+)\s+of\s+\d+\s+pairs\s+are\s+negative/);
	check("MIN_NEGATIVE_PAIRS", pairs ? Number(pairs[1]) : null, "the sign rule");

	const cost = kit.match(/v2 must not rise beyond\s*\+([0-9.]+)\s*%/);
	check("COST_DELTA_MAX", cost ? Number(cost[1]) / 100 : null, "the cost guard");
}

console.log(bad.length ? bad.join(" | ") : "agree");
