/**
 * The edit-echo verdict, applied mechanically to the FROZEN criteria in
 * kits/edit-echo-ab.md (committed 4ebac17, before any leg ran).
 *
 * This script does not choose margins. It reads them from the constants
 * below, which are transcribed from the kit, and prints the comparison
 * whether or not the result is the one the hypothesis predicted. A driver
 * that can be adjusted until it agrees is not a verdict.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toolCalls } from "./tool-calls.mjs";

const B = dirname(fileURLToPath(import.meta.url));
const ROUND = process.argv[2] ?? "edit-echo-ab";
const PAIRS = Number(process.argv[3] ?? 3);

// --- transcribed from the frozen kit. Do not edit to fit a result. ---
const READ_DELTA_MAX = -0.25;   // primary: median must be at or below this
const MIN_NEGATIVE_PAIRS = 2;   // and at least this many pairs negative
const COST_DELTA_MAX = 0.06;    // guard: BM-1's standing margin
const WALL_DELTA_MAX = 0.25;    // guard: BM-1's standing margin
const EFFORT = "high";
// ---------------------------------------------------------------------

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (x) => (x === null ? "  n/a " : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`);
const read1 = (p) => { try { return readFileSync(p, "utf8").trim(); } catch { return null; } };

const rows = JSON.parse(execFileSync("python3", [join(B, "extract-t6.py"), B], { encoding: "utf8", maxBuffer: 64e6 }))
	.filter((r) => r.round === ROUND);

function leg(run) {
	const work = join(B, "runs", ROUND, `kiso-T6-${run}`);
	const row = rows.find((r) => r.run === run) ?? null;
	const tc = existsSync(work) ? toolCalls(work, "kiso") : { observable: false, why: "no leg directory" };
	const b = row?.buckets ?? [];
	return {
		run, work, row, tc,
		status: read1(join(work, "status")),
		effort: read1(join(work, "effort_bound")),
		echo: read1(join(work, "edit_echo")),
		verify: row?.verify ?? read1(join(work, "verify")),
		predicate: row?.verify_predicate ?? null,
		boundary: row?.boundary ?? null,
		cost: b.length ? b.reduce((a, x) => a + (x.cost_weighted ?? 0), 0) : null,
		wall: b.length ? b.reduce((a, x) => a + (x.wall ?? 0), 0) : null,
		unknown: b.reduce((a, x) => a + (x.unknown_requests ?? 0), 0),
		reasoning: b.reduce((a, x) => a + (x.reasoning ?? 0), 0),
	};
}

// ---- validity, before any number is compared ------------------------
const problems = [];
function validate(l, wantEcho) {
	const p = [];
	if (l.status !== "complete") p.push(`status=${l.status}`);
	if (l.effort !== EFFORT) p.push(`effort_bound=${l.effort}`);
	if (l.echo === "none") p.push("edit_echo=none (it made no successful edit — it cannot testify)");
	else if (l.echo !== wantEcho) p.push(`edit_echo=${l.echo}, wanted ${wantEcho}`);
	if (!l.tc.observable) p.push(`tool calls not observable: ${l.tc.why}`);
	if (l.unknown > 0) p.push(`${l.unknown} request(s) with unknown usage`);
	if (p.length) problems.push(`${l.run}: ${p.join("; ")}`);
	return p.length === 0;
}

const pairs = [];
for (let i = 1; i <= PAIRS; i += 1) {
	const a = leg(`a${i}`), b = leg(`b${i}`);
	const ok = [validate(a, "off"), validate(b, "on")].every(Boolean);
	pairs.push({ i, a, b, valid: ok });
}

const usable = pairs.filter((p) => p.valid);

console.log(`\n=== edit-echo A/B — round "${ROUND}", ${usable.length} of ${PAIRS} pairs valid ===\n`);
console.log("pair  arm  verify  reads  total  edit  shell  errResults  turnOpen  cost-wtd     wall  reasoning");
for (const p of pairs) {
	for (const [tag, l] of [["A", p.a], ["B", p.b]]) {
		const f = l.tc.observable ? l.tc.byFamily : {};
		console.log(
			`  ${p.i}   ${tag}   ${String(l.verify ?? "-").padEnd(6)}` +
			`${String(f.read ?? "-").padStart(6)}${String(l.tc.total ?? "-").padStart(7)}` +
			`${String(f.edit ?? "-").padStart(6)}${String(f.shell ?? "-").padStart(7)}` +
			`${String(l.tc.errorResults ?? "-").padStart(12)}${String(l.tc.turnOpeningReads ?? "-").padStart(10)}` +
			`${String(l.cost === null ? "-" : Math.round(l.cost)).padStart(10)}` +
			`${String(l.wall ?? "-").padStart(9)}${String(l.reasoning ?? "-").padStart(11)}`,
		);
	}
}

if (problems.length) {
	console.log("\nVALIDITY PROBLEMS — a void leg is not a data point:");
	for (const p of problems) console.log(`  ${p}`);
}

if (usable.length === 0) {
	console.log("\nNO VERDICT. Fix the instrument and re-run rather than scoring around it.");
	process.exit(0);
}

const delta = (a, b) => (a === null || b === null || a === 0 ? null : (b - a) / a);
const dRead = usable.map((p) => delta(p.a.tc.byFamily.read ?? 0, p.b.tc.byFamily.read ?? 0));
const dCost = usable.map((p) => delta(p.a.cost, p.b.cost));
const dWall = usable.map((p) => delta(p.a.wall, p.b.wall));
const dTotal = usable.map((p) => delta(p.a.tc.total, p.b.tc.total));

console.log("\nper-pair relative deltas (B vs A):");
console.log("  pair    read     total     cost      wall");
usable.forEach((p, i) => console.log(
	`    ${p.i}  ${pct(dRead[i])}  ${pct(dTotal[i])}  ${pct(dCost[i])}  ${pct(dWall[i])}`));

const clean = (xs) => xs.filter((x) => x !== null);
const mRead = clean(dRead).length ? median(clean(dRead)) : null;
const mCost = clean(dCost).length ? median(clean(dCost)) : null;
const mWall = clean(dWall).length ? median(clean(dWall)) : null;
const negatives = clean(dRead).filter((x) => x < 0).length;

console.log(`\n  median read ${pct(mRead)}   cost ${pct(mCost)}   wall ${pct(mWall)}`);

// ---- the pre-registered verdict --------------------------------------
const primary = mRead !== null && mRead <= READ_DELTA_MAX && negatives >= MIN_NEGATIVE_PAIRS;
const qualityOk = usable.every((p) => p.a.verify === "pass" && p.b.verify === "pass");
const costOk = mCost !== null && mCost <= COST_DELTA_MAX;
const wallOk = mWall !== null && mWall <= WALL_DELTA_MAX;

console.log("\nagainst the criteria frozen before the runs:");
console.log(`  primary  median read ${pct(mRead)} <= ${pct(READ_DELTA_MAX)} and ${negatives}/${usable.length} pairs negative (need ${MIN_NEGATIVE_PAIRS})  -> ${primary ? "SUPPORTED" : "NOT SUPPORTED"}`);
console.log(`  quality  every leg verify=pass under predicate 2  -> ${qualityOk ? "ok" : "FAIL"}`);
console.log(`  cost     median ${pct(mCost)} <= ${pct(COST_DELTA_MAX)}  -> ${costOk ? "ok" : "FAIL"}`);
console.log(`  wall     median ${pct(mWall)} <= ${pct(WALL_DELTA_MAX)}  -> ${wallOk ? "ok" : "FAIL"}`);

let verdict;
if (!qualityOk) verdict = "BLOCKED — a quality guard failed; nothing about cost or calls is proposable";
else if (primary && costOk && wallOk) verdict = "SUPPORTED — propose shipping the echo unconditionally and deleting the switch (the owner decides)";
else if (primary && !costOk) verdict = "SUPPORTED BUT COSTLIER — the echo trades tool calls for tokens. Both numbers stand; no default, no recommendation dressed as a finding";
else if (primary && !wallOk) verdict = "SUPPORTED BUT SLOWER — report both; the wall guard is the one that failed";
else verdict = "NOT SUPPORTED — the obvious explanation was wrong. Delete the switch, record the refuted hypothesis, leave the read gap open. Do not re-run with looser criteria";
console.log(`\nVERDICT: ${verdict}\n`);
