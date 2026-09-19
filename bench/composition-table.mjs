/**
 * The composition table — what the fresh input is made of, both arms.
 *
 * Cut the way a FIX would have to cut it, which is the distinction the
 * table exists for:
 *
 *   OURS      tool results carried in (by tool and size), tool arguments,
 *             system and tool-table bytes, the number of requests, cache
 *             breaks. All of it ours to change.
 *   THE MODEL'S  reasoning volume. The API replays it on tool-carrying
 *             turns so it bills twice, but the VOLUME is the model's
 *             decision — effort is a ceiling, not a floor.
 *
 * Because if the excess sits in reasoning, the table alone says "the model
 * reasons more in our loop", and that is an attribution, not a fix. So the
 * trigger view sits beside it: reasoning per request against WHAT PRECEDED
 * that request. A volume cannot be changed; a trigger can.
 *
 * Every number is per pair, with the spread, against a stated noise floor:
 * the same product on the same task swung 2x in reasoning between two
 * legs of different rounds, and a comparison that does not clear that is
 * not a finding.
 */
import { compose } from "./compose-fresh.mjs";
import { triggers, byPredecessor } from "./reasoning-triggers.mjs";

const R = "runs/t6-capture/";
const PAIRS = [1, 2, 3];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (v, t) => t ? (100 * v / t).toFixed(1) + "%" : "n/a";

function leg(arm, p) {
	const dir = `${R}${arm}-T6-c${p}`;
	const c = compose(dir + "/capture");
	const t = triggers(dir, arm);
	return { arm, p, c, t };
}

const legs = [];
for (const p of PAIRS) for (const arm of ["kiso", "pi"]) legs.push(leg(arm, p));
const ready = legs.filter((l) => l.c && l.t?.aligned);
if (ready.length < legs.length) {
	console.log(`${legs.length - ready.length} leg(s) not ready or not aligned — the table needs all six.`);
	for (const l of legs) if (!(l.c && l.t?.aligned)) console.log(`  ${l.arm}-c${l.p}: ${l.t?.why ?? "no capture"}`);
	process.exit(0);
}

// ---- 1. what is added per request, split by who controls it -----------
console.log("=== 1. bytes ADDED between consecutive requests, per request ===");
console.log("(fresh is the DELTA, never the body: a body is mostly cached prefix)\n");
console.log("pair arm     requests   added/req   OURS: results  args  other   MODEL'S: reasoning");
for (const p of PAIRS) {
	for (const arm of ["kiso", "pi"]) {
		const { c } = ready.find((l) => l.arm === arm && l.p === p);
		const n = c.requests, t = c.addedTotal;
		const results = c.byClass["tool result"] ?? 0;
		const other = t - results - c.toolArgsWithinAdded - c.reasoningWithinAdded;
		console.log(`  ${p}  ${arm.padEnd(6)}${String(n).padStart(8)}${(t / n).toFixed(0).padStart(12)}` +
			`${(results / n).toFixed(0).padStart(15)}${(c.toolArgsWithinAdded / n).toFixed(0).padStart(6)}` +
			`${(other / n).toFixed(0).padStart(7)}${(c.reasoningWithinAdded / n).toFixed(0).padStart(20)}`);
	}
}
console.log("\n  per-pair ratio, ours over theirs:");
console.log("  pair  requests  added/req  results/req  args/req  reasoning/req");
const ratios = { requests: [], added: [], results: [], args: [], reasoning: [] };
for (const p of PAIRS) {
	const a = ready.find((l) => l.arm === "kiso" && l.p === p).c;
	const b = ready.find((l) => l.arm === "pi" && l.p === p).c;
	const per = (c, f) => f(c) / c.requests;
	const row = {
		requests: a.requests / b.requests,
		added: per(a, (c) => c.addedTotal) / per(b, (c) => c.addedTotal),
		results: per(a, (c) => c.byClass["tool result"] ?? 0) / per(b, (c) => c.byClass["tool result"] ?? 0),
		args: per(a, (c) => c.toolArgsWithinAdded) / per(b, (c) => c.toolArgsWithinAdded),
		reasoning: per(a, (c) => c.reasoningWithinAdded) / per(b, (c) => c.reasoningWithinAdded),
	};
	for (const k of Object.keys(ratios)) ratios[k].push(row[k]);
	console.log(`   ${p}  ${row.requests.toFixed(2)}x${row.added.toFixed(2).padStart(11)}x${row.results.toFixed(2).padStart(12)}x${row.args.toFixed(2).padStart(10)}x${row.reasoning.toFixed(2).padStart(14)}x`);
}
console.log("  med " + Object.keys(ratios).map((k) => median(ratios[k]).toFixed(2) + "x").map((s, i) => s.padStart([6, 12, 13, 11, 15][i])).join(""));

// ---- 2. how concentrated the reasoning is -----------------------------
console.log("\n=== 2. where the reasoning SITS ===");
console.log("pair arm     requests  any thinking  half of all reasoning is in the top");
for (const p of PAIRS) {
	for (const arm of ["kiso", "pi"]) {
		const { t } = ready.find((l) => l.arm === arm && l.p === p);
		const r = t.rows.map((x) => x.reasoning).filter((x) => x !== null);
		const total = r.reduce((a, b) => a + b, 0);
		const s = [...r].sort((a, b) => b - a);
		let acc = 0, n = 0;
		for (const v of s) { acc += v; n += 1; if (acc >= total / 2) break; }
		const thinking = r.filter((x) => x > 0).length;
		console.log(`  ${p}  ${arm.padEnd(6)}${String(r.length).padStart(8)}${(thinking + " (" + (100 * thinking / r.length).toFixed(0) + "%)").padStart(14)}` +
			`${(n + " requests (" + (100 * n / r.length).toFixed(0) + "%)").padStart(22)}`);
	}
}

// ---- 3. the trigger view ----------------------------------------------
console.log("\n=== 3. reasoning by WHAT PRECEDED the request (all pairs pooled) ===");
console.log("(a volume cannot be changed; a trigger can)\n");
for (const arm of ["kiso", "pi"]) {
	const rows = ready.filter((l) => l.arm === arm).flatMap((l) => l.t.rows);
	console.log(`  ${arm} — ${rows.length} requests over ${PAIRS.length} legs`);
	console.log("    predecessor                          n   median   mean   share of all reasoning");
	const total = rows.reduce((a, r) => a + (r.reasoning ?? 0), 0);
	const g = {};
	for (const r of rows) {
		if (r.reasoning === null) continue;
		const key = r.kind === "tool result" ? `after ${r.tool}${r.errored ? " (ERROR)" : ""}` : `after a ${r.kind}`;
		(g[key] ??= []).push(r.reasoning);
	}
	Object.entries(g).map(([k, v]) => ({ k, n: v.length, med: median(v), mean: v.reduce((a, b) => a + b, 0) / v.length, sum: v.reduce((a, b) => a + b, 0) }))
		.sort((a, b) => b.sum - a.sum)
		.forEach((r) => console.log(`    ${r.k.padEnd(35)}${String(r.n).padStart(3)}${String(r.med).padStart(9)}${r.mean.toFixed(0).padStart(7)}${pct(r.sum, total).padStart(24)}`));
	console.log();
}

// ---- 4. the heaviest requests, named ----------------------------------
console.log("=== 4. the requests that carry half the reasoning, and what preceded each ===\n");
for (const arm of ["kiso", "pi"]) {
	const rows = ready.filter((l) => l.arm === arm).flatMap((l) => l.t.rows.map((r) => ({ ...r, leg: `c${l.p}` })));
	const total = rows.reduce((a, r) => a + (r.reasoning ?? 0), 0);
	const s = [...rows].filter((r) => r.reasoning !== null).sort((a, b) => b.reasoning - a.reasoning);
	let acc = 0;
	console.log(`  ${arm}:`);
	for (const r of s) {
		acc += r.reasoning;
		const desc = r.kind === "tool result" ? `${r.tool}${r.errored ? " (ERROR)" : ""}, result ${r.resultBytes}B` : `a ${r.kind}`;
		console.log(`    ${r.leg} #${String(r.index).padStart(3)}  ${String(r.reasoning).padStart(6)} tokens   after ${desc}`);
		if (acc >= total / 2) break;
	}
	console.log();
}
console.log("NOISE FLOOR: the same product on the same task swung 2x in reasoning between");
console.log("two legs of different rounds. A difference that does not clear that is not a finding.");
