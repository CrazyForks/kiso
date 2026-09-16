/**
 * Round A's verdict, applied mechanically to the criteria frozen in
 * kits/tool-table-a.md before any leg ran.
 *
 * This script does not choose margins. It reads them from the constants
 * below, transcribed from the kit and compared against it by
 * tests/criteria-agree.mjs, and it prints the comparison whether or not
 * the result is the one the hypothesis predicted.
 *
 * AND IT REFUSES ON A VOID LEG rather than scoring around one. A leg
 * labelled A whose table still carried `delegate` is not an A leg; folding
 * it in would make both arms agree because they were the same arm.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { toolCalls } from "./tool-calls.mjs";
import { triggers } from "./reasoning-triggers.mjs";

const B = dirname(fileURLToPath(import.meta.url));
const ROUND = process.argv[2] ?? "tool-table-a";
const PAIRS = Number(process.argv[3] ?? 9);

// --- transcribed from the frozen kit. Do not edit to fit a result. ---
const REASONING_DELTA_MAX = -0.30;  // primary: the median must be at or below
const MIN_NEGATIVE_PAIRS = 6;       // and at least this many of nine negative
const COST_DELTA_MAX = 0.06;        // guard: BM-1's standing margin
const EFFORT = "high";
// ---------------------------------------------------------------------

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x) => (x === null ? "  n/a" : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`);
const read1 = (p) => { try { return readFileSync(p, "utf8").trim(); } catch { return null; } };

const rows = JSON.parse(execFileSync("python3", [join(B, "extract-t6.py"), B], { encoding: "utf8", maxBuffer: 64e6 }))
	.filter((r) => r.round === ROUND);

/** How many user turns the leg actually ran, from its durable log. */
function turnsOf(work) {
	try {
		const dir = join(work, "kiso-home", "sessions");
		const f = readdirSync(dir).find((x) => x.endsWith(".jsonl") && !x.includes("trace"));
		let n = 0;
		for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
			if (!line.trim()) continue;
			let o;
			try { o = JSON.parse(line); } catch { continue; }
			if ((o.event ?? o).type === "user_input") n += 1;
		}
		return n || null;
	} catch { return null; }
}

function leg(run, wantDelegate) {
	const work = join(B, "runs", ROUND, `kiso-T6-${run}`);
	const row = rows.find((r) => r.run === run) ?? null;
	const b = row?.buckets ?? [];
	const table = read1(join(work, "tool_table")) ?? "";
	const t = existsSync(work) ? triggers(work, "kiso") : null;
	const reasoning = t?.aligned ? t.rows.reduce((a, r) => a + (r.reasoning ?? 0), 0) : null;
	const requests = t?.aligned ? t.rows.length : null;
	const problems = [];
	const status = read1(join(work, "status"));
	if (status !== "complete") problems.push(`status=${status}`);
	if (read1(join(work, "effort_wire")) !== EFFORT) problems.push(`effort not wire-verified`);
	const has = table.includes("delegate");
	if (has !== wantDelegate) problems.push(`delegate ${has ? "present" : "absent"}, wanted ${wantDelegate ? "present" : "absent"}`);
	if (!t?.aligned) problems.push(`capture not aligned: ${t?.why ?? "no capture"}`);
	return {
		run, problems,
		reasoning, requests,
		reasoningPerRequest: reasoning !== null && requests ? reasoning / requests : null,
		v2: b.length ? b.reduce((a, x) => a + (x.fresh ?? 0) + 0.02 * (x.cache_read ?? 0) + 4 * (x.output ?? 0), 0) : null,
		verify: row?.verify ?? read1(join(work, "verify")),
		toolCalls: existsSync(work) ? (toolCalls(work, "kiso").total ?? null) : null,
		// TURNS COME FROM THE SESSION LOG, not from the capture rows. The
		// rows carry no turn field, so `new Set([undefined]).size` was 1 on
		// every leg and req/turn printed the request count back as itself —
		// a column that looked like a measurement and was an identity.
		turns: turnsOf(work),
	};
}

const pairs = [];
for (let i = 1; i <= PAIRS; i += 1) {
	const ctl = leg(`ctl${i}`, true);
	const a = leg(`a${i}`, false);
	pairs.push({ i, ctl, a, valid: ctl.problems.length === 0 && a.problems.length === 0 });
}
const usable = pairs.filter((p) => p.valid);

console.log(`\n=== round A — the default tool table, "${ROUND}", ${usable.length} of ${PAIRS} pairs valid ===\n`);
console.log("pair arm   verify  requests  reasoning  rsn/req   v2 index   toolcalls  req/turn");
for (const p of pairs) for (const [tag, l] of [["ctl", p.ctl], ["A  ", p.a]]) {
	console.log(`  ${p.i}  ${tag}  ${String(l.verify ?? "-").padEnd(6)}` +
		`${String(l.requests ?? "-").padStart(9)}${String(l.reasoning ?? "-").padStart(11)}` +
		`${(l.reasoningPerRequest === null ? "-" : l.reasoningPerRequest.toFixed(1)).padStart(9)}` +
		`${(l.v2 === null ? "-" : Math.round(l.v2)).toString().padStart(11)}` +
		`${String(l.toolCalls ?? "-").padStart(12)}` +
		`${(l.requests && l.turns ? (l.requests / l.turns).toFixed(1) : "-").padStart(10)}`);
}

const problems = pairs.flatMap((p) => [...p.ctl.problems.map((x) => `ctl${p.i}: ${x}`), ...p.a.problems.map((x) => `a${p.i}: ${x}`)]);
if (problems.length) { console.log("\nVALIDITY PROBLEMS — a void leg is not a data point:"); for (const x of problems) console.log(`  ${x}`); }
if (usable.length === 0) { console.log("\nNO VERDICT. Fix the instrument and re-run rather than scoring around it.\n"); process.exit(0); }

const d = (a, b) => (a === null || b === null || a === 0 ? null : (b - a) / a);
const dR = usable.map((p) => d(p.ctl.reasoningPerRequest, p.a.reasoningPerRequest));
const dV = usable.map((p) => d(p.ctl.v2, p.a.v2));
console.log("\nper-pair relative deltas (A vs control):");
console.log("  pair   reasoning/req      v2");
usable.forEach((p, i) => console.log(`    ${p.i}      ${pct(dR[i]).padStart(8)}   ${pct(dV[i]).padStart(8)}`));

const clean = (xs) => xs.filter((x) => x !== null);
const mR = clean(dR).length ? median(clean(dR)) : null;
const mV = clean(dV).length ? median(clean(dV)) : null;
const neg = clean(dR).filter((x) => x < 0).length;
console.log(`\n  median reasoning/req ${pct(mR)}   v2 ${pct(mV)}   negative pairs ${neg}/${usable.length}`);

const primary = mR !== null && mR <= REASONING_DELTA_MAX && neg >= MIN_NEGATIVE_PAIRS;
const qualityOk = usable.every((p) => p.ctl.verify === "pass" && p.a.verify === "pass");
const costOk = mV !== null && mV <= COST_DELTA_MAX;
console.log("\nagainst the criteria frozen before the runs:");
console.log(`  primary  median ${pct(mR)} <= ${pct(REASONING_DELTA_MAX)} and ${neg}/${usable.length} negative (need ${MIN_NEGATIVE_PAIRS})  -> ${primary ? "SUPPORTED" : "NOT SUPPORTED"}`);
console.log(`  quality  every leg verify=pass  -> ${qualityOk ? "ok" : "FAIL"}`);
console.log(`  cost     median v2 ${pct(mV)} <= ${pct(COST_DELTA_MAX)}  -> ${costOk ? "ok" : "FAIL"}`);

let verdict;
if (!qualityOk) verdict = "BLOCKED — a quality guard failed; nothing about the table is proposable";
else if (primary && costOk) verdict = "SUPPORTED — propose DEFERRING delegate: a discovery tool in the default table, the capability loaded automatically on demand, never configured by hand. The owner decides. State in the first line that the bench has never had a delegable subtask and that the owner's own sessions use it 7 times in 96";
else if (primary && !costOk) verdict = "SUPPORTED BUT COSTLIER — both numbers stand, no default, no recommendation dressed as a finding";
else verdict = "NOT SUPPORTED — the default table is not what moves the thinking on this task. delegate stays present; the projection idea is MOOT rather than pending, since removing an unused tool moved nothing. Not re-run with a looser bar";
console.log(`\nVERDICT: ${verdict}\n`);
