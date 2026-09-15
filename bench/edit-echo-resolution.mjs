/**
 * Could this round have SEEN the effect it was looking for?
 *
 * Separate from edit-echo-verdict.mjs on purpose. The verdict applies the
 * frozen criteria and nothing else. This asks a different question, and it
 * is one I should have asked BEFORE freezing n = 3: what is the run-to-run
 * spread of the quantity being compared?
 *
 * The round's A legs are pure replicates — same binary, same switch
 * position, same task, same model — so the spread among them is noise with
 * no signal in it at all. If that spread is the size of the effect being
 * looked for, then "NOT SUPPORTED" and "the instrument cannot see it"
 * produce the same output, and the round decides nothing.
 *
 * THE ARITHMETIC BELOW IS AN ORDER-OF-MAGNITUDE ARGUMENT, NOT A POWER
 * CALCULATION. A variance estimated from three points is itself extremely
 * noisy, and the frozen criterion is a median-and-sign rule rather than a
 * test with a standard error. Read it as "roughly what scale of n would be
 * needed", never as a number to plan against.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toolCalls } from "./tool-calls.mjs";

const B = dirname(fileURLToPath(import.meta.url));
const ROUND = process.argv[2] ?? "edit-echo-ab";
const PAIRS = Number(process.argv[3] ?? 3);

const legDir = (run) => join(B, "runs", ROUND, `kiso-T6-${run}`);
const wallOf = (dir) => {
	let w = 0;
	for (let p = 1; p <= 4; p += 1) {
		try { w += Number(readFileSync(join(dir, `wall_${p}`), "utf8").trim()); } catch { return null; }
	}
	return w;
};
function metrics(run) {
	const d = legDir(run);
	if (!existsSync(d)) return null;
	// A LEG STILL RUNNING IS NOT A REPLICATE. The first version read every
	// directory that existed, so a leg five turns in contributed its
	// partial counts to the spread — inflating exactly the variance this
	// script exists to estimate, in the direction that makes my own
	// experiment look better excused. Complete, or not counted.
	let status = null;
	try { status = readFileSync(join(d, "status"), "utf8").trim(); } catch { /* absent = not finished */ }
	if (status !== "complete") return null;
	const t = toolCalls(d, "kiso");
	if (!t.observable) return null;
	const f = t.byFamily;
	return {
		read: f.read ?? 0,
		total: t.total,
		edit: f.edit ?? 0,
		wall: wallOf(d),
		// A RATE, not a count: of the edits this leg made, how many were
		// followed immediately by a read of that same file. Rates usually
		// carry less run-to-run noise than the counts they come from, and
		// this one names the behaviour the hypothesis is actually about.
		// NOT PRE-REGISTERED — reported beside the verdict, never inside it.
		reReadRate: (f.edit ?? 0) === 0 ? null : t.readsImmediatelyAfterOwnEdit / (f.edit ?? 1),
	};
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
	if (xs.length < 2) return null;
	const m = mean(xs);
	return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const fmt = (x, d = 1) => (x === null || Number.isNaN(x) ? "  n/a" : x.toFixed(d));

const A = [], Bl = [];
for (let i = 1; i <= PAIRS; i += 1) {
	const a = metrics(`a${i}`), b = metrics(`b${i}`);
	if (a) A.push(a);
	if (b) Bl.push(b);
}

console.log(`\n=== resolution of round "${ROUND}" — ${A.length} control replicates, ${Bl.length} echo legs ===\n`);
if (A.length < 2) {
	console.log("fewer than two control replicates: the noise cannot be estimated at all.\n");
	process.exit(0);
}

const show = (name, key, digits = 1) => {
	const a = A.map((x) => x[key]).filter((x) => x !== null);
	const b = Bl.map((x) => x[key]).filter((x) => x !== null);
	const s = sd(a), m = mean(a);
	const cv = s === null || m === 0 ? null : s / m;
	console.log(`${name.padEnd(14)} control legs: ${a.map((x) => fmt(x, digits)).join(", ").padEnd(24)}` +
		`mean ${fmt(m, digits).padStart(7)}  sd ${fmt(s, digits).padStart(6)}  CV ${cv === null ? " n/a" : (100 * cv).toFixed(0) + "%"}`);
	if (b.length) console.log(`${"".padEnd(14)} echo legs:    ${b.map((x) => fmt(x, digits)).join(", ")}`);
	return cv;
};

const cvRead = show("read calls", "read");
show("total calls", "total");
show("edits", "edit");
show("wall (s)", "wall", 0);
show("re-read rate", "reReadRate", 2);

console.log("\nThe control legs differ from each OTHER with no signal between them.");
if (cvRead !== null) {
	// Two independent draws, so the per-pair relative delta carries roughly
	// sqrt(2) times one leg's coefficient of variation.
	const sdDelta = cvRead * Math.SQRT2;
	const effect = 0.25; // the frozen primary threshold, as a magnitude
	const nFor = Math.ceil(((1.96 * sdDelta) / effect) ** 2);
	console.log(`\n  read-count CV among replicates: ${(100 * cvRead).toFixed(0)}%`);
	console.log(`  so a per-pair relative delta carries roughly +/-${(100 * sdDelta).toFixed(0)}% of noise`);
	console.log(`  against an effect of ${100 * effect}%, separating them needs on the order of ${nFor} pairs`);
	console.log(`  this round ran ${PAIRS}.`);
	if (nFor > PAIRS * 2) {
		console.log(`\n  SO A "NOT SUPPORTED" FROM THIS ROUND IS WEAK EVIDENCE, NOT STRONG.`);
		console.log(`  It does not separate "the mechanism is false" from "the instrument`);
		console.log(`  could not see it". Saying otherwise would be claiming a resolution`);
		console.log(`  the round does not have.`);
	}
}
console.log();
