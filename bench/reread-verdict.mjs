#!/usr/bin/env node
/**
 * The re-read exemption round's verdict, applied mechanically to the
 * criteria frozen in kits/reread-exemption.md before any leg ran.
 *
 * This script does not choose margins. It reads them from the constants
 * below, transcribed from the kit and compared against it by
 * tests/test_reread_criteria.mjs, and it prints the comparison whether or
 * not the result is the one the change hoped for.
 *
 * AND IT REFUSES ON A VOID LEG rather than scoring around one. A leg
 * launched as the arm whose own captured bodies carry the published
 * prompt is not an arm leg; folding it in would make both arms agree
 * because they were the same arm.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readbackRate, callStream } from "./readback-rate.mjs";
import { rng } from "./concealed/rng.mjs";

const B = dirname(fileURLToPath(import.meta.url));
const ROUND = process.argv[2] ?? "reread";
const PAIRS = Number(process.argv[3] ?? 22);

// --- transcribed from the frozen kit. Do not edit to fit a result. ---
const RATE_DELTA_MAX = -0.50;     // primary: the median must be at or below
const BOOTSTRAP_N = 20000;        // secondary: resamples
const BOOTSTRAP_SEED = "20260916";
const REFUSED_SHARE_MAX = 0.12;   // guard: refused share of edit calls
const COST_DELTA_MAX = 0.06;      // guard: this round's own stricter choice
const ARM_PROMPT = "exemption-extended";
const CTL_PROMPT = "published";
// ---------------------------------------------------------------------

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const pct = (x) => (x === null || Number.isNaN(x) ? "  n/a" : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`);
const read1 = (p) => { try { return readFileSync(p, "utf8").trim(); } catch { return null; } };

/** Two refusal MECHANISMS, counted apart — the kit's guard splits on this. */
function refusals(work) {
	// callStream gives one row per call and whether it failed, which is the
	// denominator; the SPLIT needs the failure text, which that stream does
	// not carry, so the log is walked once more here for it.
	const edits = callStream(work).filter((c) => c.name === "edit_file").length;
	let stale = 0, pattern = 0, other = 0;
	const dir = join(work, "kiso-home", "sessions");
	if (existsSync(dir)) {
		const f = readdirSync(dir).find((x) => x.endsWith(".jsonl") && !x.includes("trace"));
		if (f) {
			const input = new Map(); const seen = new Set();
			for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
				if (!line.trim()) continue;
				let r; try { r = JSON.parse(line); } catch { continue; }
				const e = r?.event; if (!e) continue;
				if (e.type === "tool_call_end") input.set(e.callId, e.name);
				const txt = e.type === "tool_execution_failed" ? String(e.error ?? "")
					: (e.type === "tool_result" && e.isError ? String(e.content ?? "") : null);
				if (txt === null) continue;
				if (input.get(e.callId) !== "edit_file") continue;
				if (seen.has(e.callId)) continue;
				seen.add(e.callId);
				if (/changed since rev:/i.test(txt)) stale++;
				else if (/pattern not found/i.test(txt)) pattern++;
				else other++;
			}
		}
	}
	return { edits, stale, pattern, other, refused: stale + pattern + other };
}

const rows = JSON.parse(execFileSync("python3", [join(B, "extract-t6.py"), B], { encoding: "utf8", maxBuffer: 64e6 }))
	.filter((r) => r.round === ROUND);

function leg(run, wantPrompt) {
	const work = join(B, "runs", ROUND, `kiso-T6-${run}`);
	const row = rows.find((r) => r.run === run) ?? null;
	const b = row?.buckets ?? [];
	const rate = existsSync(work) ? readbackRate(work) : null;
	const ref = existsSync(work) ? refusals(work) : null;
	const sawPrompt = read1(join(work, "prompt_arm"));
	const problems = [];
	if (!existsSync(work)) problems.push(`${run}: no leg directory`);
	if (existsSync(join(work, "void"))) problems.push(`${run}: VOID — ${read1(join(work, "void"))}`);
	if (sawPrompt !== wantPrompt) problems.push(`${run}: its bodies carry ${sawPrompt ?? "nothing"}, wanted ${wantPrompt}`);
	if (read1(join(work, "status")) !== "complete") problems.push(`${run}: status=${read1(join(work, "status"))}`);
	if (rate && rate.rate === null) problems.push(`${run}: no repeat edit — the metric has no denominator on this leg`);
	return {
		run, work, problems,
		verify: read1(join(work, "verify")),
		rate: rate?.rate ?? null, repeatEdits: rate?.repeatEdits ?? 0, repeatWithRead: rate?.repeatWithRead ?? 0,
		ref,
		v2: b.length ? b.reduce((a, x) => a + (x.fresh ?? 0) + 0.02 * (x.cache_read ?? 0) + 4 * (x.output ?? 0), 0) : null,
		requests: b.reduce((a, x) => a + (x.requests ?? 0), 0),
	};
}

const pairs = [];
const problems = [];
for (let i = 1; i <= PAIRS; i++) {
	const ctl = leg(`c${i}`, CTL_PROMPT);
	const arm = leg(`a${i}`, ARM_PROMPT);
	problems.push(...ctl.problems, ...arm.problems);
	pairs.push({ i, ctl, arm });
}

console.log(`=== the re-read exemption — round "${ROUND}", ${PAIRS} pairs ===\n`);
console.log("pair arm  verify  requests  repeat-edits  read-backs   rate   refused(stale/pattern)");
for (const p of pairs) for (const [tag, l] of [["ctl", p.ctl], ["arm", p.arm]]) {
	console.log(`${String(p.i).padStart(3)}  ${tag}  ${String(l.verify ?? "-").padStart(6)}  ${String(l.requests).padStart(8)}  ${String(l.repeatEdits).padStart(12)}  ${String(l.repeatWithRead).padStart(10)}  ${(l.rate === null ? "n/a" : `${(100 * l.rate).toFixed(1)}%`).padStart(6)}   ${l.ref ? `${l.ref.refused} (${l.ref.stale}/${l.ref.pattern})` : "-"}`);
}

if (problems.length) {
	console.log("\nTHE ROUND IS NOT SCORABLE:");
	for (const p of problems) console.log(`  ${p}`);
	console.log("\nNO VERDICT. Fix the instrument or re-run the leg rather than scoring around it.");
	process.exit(1);
}

const d = (c, a) => (c === null || a === null || c === 0 ? null : (a - c) / c);
const dRate = pairs.map((p) => d(p.ctl.rate, p.arm.rate)).filter((x) => x !== null);
const dV2 = pairs.map((p) => d(p.ctl.v2, p.arm.v2)).filter((x) => x !== null);

console.log("\nper-pair relative deltas (arm vs control):");
console.log("  pair   read-back rate      v2");
pairs.forEach((p, k) => console.log(`  ${String(p.i).padStart(4)}     ${pct(d(p.ctl.rate, p.arm.rate)).padStart(10)}  ${pct(d(p.ctl.v2, p.arm.v2)).padStart(8)}`));

const mRate = median(dRate), mV2 = median(dV2);
const neg = dRate.filter((x) => x < 0).length;
console.log(`\n  median read-back delta ${pct(mRate)}   v2 ${pct(mV2)}   negative pairs ${neg}/${dRate.length} (REPORTED, not a bar)`);

// SECONDARY: the bootstrap interval of the median, seeded so it replays.
const r = rng(BOOTSTRAP_SEED);
const meds = [];
for (let b = 0; b < BOOTSTRAP_N; b++) {
	const s = [];
	for (let k = 0; k < dRate.length; k++) s.push(dRate[Math.floor(r() * dRate.length)]);
	meds.push(median(s));
}
meds.sort((a, b) => a - b);
const lo = meds[Math.floor(0.025 * BOOTSTRAP_N)], hi = meds[Math.floor(0.975 * BOOTSTRAP_N)];
const excludesZero = hi < 0 || lo > 0;

// GUARDS
const verifyAll = pairs.every((p) => p.ctl.verify === "pass" && p.arm.verify === "pass");
const staleRise = pairs.filter((p) => (p.arm.ref?.stale ?? 0) > (p.ctl.ref?.stale ?? 0));
const armEdits = pairs.reduce((a, p) => a + (p.arm.ref?.edits ?? 0), 0);
const armRefused = pairs.reduce((a, p) => a + (p.arm.ref?.refused ?? 0), 0);
const refusedShare = armEdits ? armRefused / armEdits : 0;
const costOk = mV2 !== null && mV2 <= COST_DELTA_MAX;

console.log("\nagainst the criteria frozen before the runs:");
console.log(`  PRIMARY    median ${pct(mRate)} <= ${pct(RATE_DELTA_MAX)}  -> ${mRate !== null && mRate <= RATE_DELTA_MAX ? "MET" : "not met"}`);
console.log(`  SECONDARY  bootstrap 95% of the median [${pct(lo)}, ${pct(hi)}] (n=${BOOTSTRAP_N}, seed ${BOOTSTRAP_SEED})  -> ${excludesZero ? "excludes zero" : "includes zero"}`);
console.log(`  guard quality   every leg verify=pass  -> ${verifyAll ? "ok" : "FAIL"}`);
console.log(`  guard stale-rev arm not above control, per leg  -> ${staleRise.length === 0 ? "ok" : `FAIL on pairs ${staleRise.map((p) => p.i).join(", ")}`}`);
console.log(`  guard refusals  arm refused ${armRefused}/${armEdits} = ${(100 * refusedShare).toFixed(1)}% <= ${100 * REFUSED_SHARE_MAX}%  -> ${refusedShare <= REFUSED_SHARE_MAX ? "ok" : "FAIL"}`);
console.log(`  guard cost      median v2 ${pct(mV2)} <= ${pct(COST_DELTA_MAX)}  -> ${costOk ? "ok" : "FAIL"}`);

const guardsOk = verifyAll && staleRise.length === 0 && refusedShare <= REFUSED_SHARE_MAX && costOk;
let verdict;
if (!guardsOk) verdict = "BLOCKED — a guard failed; nothing about the clause is proposable, whatever the readings say";
else if (mRate !== null && mRate <= RATE_DELTA_MAX) verdict = "PRIMARY — the sentence is most of the gap. The change ships as its own PR and release; the sequencing is the owner's";
else if (excludesZero && mRate !== null && mRate < 0) verdict = "SECONDARY — a real but smaller effect, every guard green. The decision is the owner's judgement, not this round's to dismiss";
else verdict = "NOT SUPPORTED — the sentence stays as published. The read-back stands as measured and unexplained; candidate C is closed, not parked";
console.log(`\nVERDICT: ${verdict}`);
