#!/usr/bin/env node
/**
 * The small launch bench's report (kit: kits/launch-small.md).
 *
 *   node bench/launch-report.mjs <runs root> <round> [--json]
 *
 * DESCRIPTIVE, by the kit: no marketing verdict and no pass/fail bar. Per
 * part, and per family in the concealed set, per arm:
 *   - verify: the pass count out of the valid legs;
 *   - cost v2 (F + 0.02·H + 4·O; the output includes reasoning on both
 *     arms, checked on real records);
 *   - wall and requests (medians).
 * Across the pairs:
 *   - the median of the per-pair relative deltas d = (kiso − ref) / ref,
 *     with a 95% bootstrap interval (seed and draws fixed in the kit).
 *
 * What never happens silently:
 *   - A VOID leg is excluded and counted; its pair has no delta.
 *   - A leg with UNKNOWN usage stays in the table, marked. Its cost is
 *     not a number, so its pair has no cost delta. Unknown is never zero.
 *   - An INCOMPLETE part (the cap was hit) reports its legs and NO
 *     comparative figure.
 *   - Per leg, the report surfaces:
 *     - floor and read-only-shell decisions;
 *     - compactions;
 *     - abandoned drafts (a mid-stream retry);
 *     - extra captured calls (an in-place retry);
 *     - the served model and the wire effort.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const B = dirname(fileURLToPath(import.meta.url));
export const BOOTSTRAP = { seed: 20260919, draws: 20000 };
const PARTS = [
	{ part: "t5", extractor: "extract-t5.py", pattern: null },
	{ part: "t6", extractor: "extract-t6.py", pattern: "T6" },
	{ part: "concealed", extractor: "extract-t6.py", pattern: "" },
];

export function median(xs) {
	const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (s.length === 0) return null;
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** mulberry32 — the kit's fixed-seed generator, so the interval is reproducible */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The 95% percentile bootstrap interval of the median. */
export function bootstrapMedianCI(xs, { seed, draws } = BOOTSTRAP) {
	const v = xs.filter((x) => Number.isFinite(x));
	if (v.length < 2) return null;
	const r = rng(seed);
	const meds = [];
	for (let d = 0; d < draws; d++) {
		const s = [];
		for (let i = 0; i < v.length; i++) s.push(v[Math.floor(r() * v.length)]);
		meds.push(median(s));
	}
	meds.sort((a, b) => a - b);
	return [meds[Math.floor(0.025 * draws)], meds[Math.floor(0.975 * draws) - 1]];
}

function ledger(partdir) {
	const p = join(partdir, "ledger.tsv");
	if (!existsSync(p)) return new Map();
	const [head, ...rows] = readFileSync(p, "utf8").trim().split("\n");
	const cols = head.split("\t");
	const out = new Map();
	for (const row of rows) {
		const o = Object.fromEntries(row.split("\t").map((v, i) => [cols[i], v]));
		out.set(o.leg, o);
	}
	return out;
}

function extract(partdir, extractor, pattern) {
	const tmp = mkdtempSync(join(tmpdir(), "launch-report-"));
	try {
		symlinkSync(partdir, join(tmp, "runs"));
		const args = [join(B, extractor), tmp, ...(pattern === null ? [] : [pattern])];
		return JSON.parse(execFileSync("python3", args, { encoding: "utf8", maxBuffer: 64 << 20 }));
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

/** The totals of a row from either extractor. */
function totals(row) {
	if (Array.isArray(row.buckets)) {
		const sum = (k) => row.buckets.reduce((n, b) => n + (Number.isFinite(b[k]) ? b[k] : 0), 0);
		const unknown = sum("unknown_requests");
		return { fresh: sum("fresh"), cache: sum("cache_read"), output: sum("output"), reasoning: sum("reasoning"), requests: sum("requests"), unknown, wall: sum("wall") };
	}
	return { fresh: row.fresh, cache: row.cache_read, output: row.output, reasoning: row.reasoning, requests: row.requests, unknown: row.unknown_requests ?? 0, wall: row.wall, incomplete: row.usage_incomplete === true };
}

/** The per-leg facts the lead's condition 3 wants reported, never absorbed. */
function legEvents(work, tool) {
	const ev = { floor: 0, readOnlyShell: 0, compactions: 0, abandoned: 0 };
	try {
		if (tool === "kiso") {
			const dir = join(work, "kiso-home", "sessions");
			for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl") && !x.startsWith("sub-"))) {
				for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
					if (line.trim() === "") continue;
					let e;
					try {
						e = JSON.parse(line).event;
					} catch {
						continue;
					}
					if (e?.type === "permission_decided" && e.decidedBy === "floor") ev.floor += 1;
					if (e?.type === "permission_decided" && e.decidedBy === "read-only-shell") ev.readOnlyShell += 1;
					if (e?.type === "summarized" || e?.type === "microcompacted") ev.compactions += 1;
					if (e?.type === "model_output_abandoned") ev.abandoned += 1;
				}
			}
		} else {
			const p = join(work, "pi-session");
			const files = existsSync(p) ? readdirSync(p).filter((x) => x.endsWith(".jsonl")).map((x) => join(p, x)) : [];
			for (const f of files) {
				for (const line of readFileSync(f, "utf8").split("\n")) {
					if (line.includes('"type":"compaction"')) ev.compactions += 1;
				}
			}
		}
	} catch {
		ev.unreadable = true;
	}
	return ev;
}

function sidecar(work, name) {
	try {
		return readFileSync(join(work, name), "utf8").trim();
	} catch {
		return null;
	}
}

function servedModel(work) {
	try {
		const c = JSON.parse(readFileSync(join(work, "config.json"), "utf8"));
		return c.observed?.model ?? null;
	} catch {
		return null;
	}
}

/** Pair legs by (task, run); a pair has deltas only when both legs are valid. */
export function summarize(legs, { incomplete }) {
	const arms = ["kiso", "pi"];
	const byArm = Object.fromEntries(arms.map((a) => [a, legs.filter((l) => l.tool === a)]));
	const armSummary = (ls) => {
		const valid = ls.filter((l) => !l.void);
		return {
			legs: ls.length,
			void: ls.length - valid.length,
			verifyPass: valid.filter((l) => l.verify === "pass").length,
			verifyOf: valid.length,
			unknownUsageLegs: valid.filter((l) => l.unknownUsage).length,
			medianCostV2: median(valid.filter((l) => !l.unknownUsage).map((l) => l.costV2)),
			medianWall: median(valid.map((l) => l.wall)),
			medianRequests: median(valid.map((l) => l.requests)),
		};
	};
	const out = { arms: Object.fromEntries(arms.map((a) => [a, armSummary(byArm[a])])) };
	if (incomplete) {
		out.comparative = null;
		out.why = "INCOMPLETE: the part hit its request cap — no comparative figure";
		return out;
	}
	const pairs = [];
	for (const k of byArm.kiso) {
		const r = byArm.pi.find((p) => p.task === k.task && p.run === k.run);
		if (!r || k.void || r.void) continue;
		pairs.push({
			task: k.task,
			run: k.run,
			dCost: k.unknownUsage || r.unknownUsage || !r.costV2 ? null : (k.costV2 - r.costV2) / r.costV2,
			dWall: r.wall ? (k.wall - r.wall) / r.wall : null,
		});
	}
	const dc = pairs.map((p) => p.dCost).filter((x) => x !== null);
	const dw = pairs.map((p) => p.dWall).filter((x) => x !== null);
	out.comparative = {
		pairs: pairs.length,
		costPairs: dc.length,
		medianDCost: median(dc),
		ciDCost: bootstrapMedianCI(dc),
		medianDWall: median(dw),
		ciDWall: bootstrapMedianCI(dw),
	};
	out.pairs = pairs;
	return out;
}

export function report(root, round) {
	const result = { round, bootstrap: BOOTSTRAP, parts: {} };
	for (const { part, extractor, pattern } of PARTS) {
		const partdir = join(root, `${round}-${part}`);
		if (!existsSync(partdir)) continue;
		const led = ledger(partdir);
		const rows = extract(partdir, extractor, pattern);
		const legs = rows
			.filter((row) => row.tool === "kiso" || row.tool === "pi")
			.map((row) => {
				const leg = `${row.tool}-${row.task}-${row.run}`;
				const work = join(partdir, leg);
				const t = totals(row);
				const l = led.get(leg) ?? {};
				const unknownUsage = t.unknown > 0 || t.incomplete === true || row.error !== undefined;
				return {
					leg,
					tool: row.tool,
					task: row.task,
					run: row.run,
					family: part === "concealed" ? String(row.task).split("-")[0] : null,
					verify: row.verify ?? sidecar(work, "verify"),
					void: (l.void && l.void !== "-") || existsSync(join(work, "void")),
					status: sidecar(work, "status"),
					extraCalls: l.extra_calls ?? null,
					effortWire: sidecar(work, "effort_wire"),
					servedModel: servedModel(work),
					unknownUsage,
					costV2: unknownUsage ? null : t.fresh + 0.02 * t.cache + 4 * t.output,
					...t,
					events: legEvents(work, row.tool),
				};
			});
		const incomplete = existsSync(join(partdir, "INCOMPLETE"));
		const entry = { incomplete, legs, overall: summarize(legs, { incomplete }) };
		if (part === "concealed") {
			entry.families = {};
			for (const fam of [...new Set(legs.map((l) => l.family))].sort()) {
				entry.families[fam] = summarize(legs.filter((l) => l.family === fam), { incomplete });
			}
		}
		result.parts[part] = entry;
	}
	return result;
}

const pct = (x) => (x === null || x === undefined ? "—" : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)}%`);
const ci = (c) => (c ? `[${pct(c[0])}, ${pct(c[1])}]` : "—");

function markdown(r) {
	const lines = [`# Small launch bench — ${r.round}`, ""];
	for (const [part, e] of Object.entries(r.parts)) {
		const block = (title, s) => {
			lines.push(`### ${title}${e.incomplete ? " — INCOMPLETE (cap hit; no comparative figure)" : ""}`, "");
			lines.push("| arm | legs | void | verify | unknown usage | median cost v2 | median wall s | median requests |", "|---|---:|---:|---:|---:|---:|---:|---:|");
			for (const [arm, a] of Object.entries(s.arms)) {
				lines.push(`| ${arm} | ${a.legs} | ${a.void} | ${a.verifyPass}/${a.verifyOf} | ${a.unknownUsageLegs} | ${a.medianCostV2 === null ? "—" : Math.round(a.medianCostV2)} | ${a.medianWall ?? "—"} | ${a.medianRequests ?? "—"} |`);
			}
			if (s.comparative) {
				const c = s.comparative;
				lines.push("", `pairs ${c.pairs} (cost ${c.costPairs}) · median Δcost ${pct(c.medianDCost)} ${ci(c.ciDCost)} · median Δwall ${pct(c.medianDWall)} ${ci(c.ciDWall)} — Δ = (kiso − reference) / reference`);
			}
			lines.push("");
		};
		block(part, e.overall);
		if (e.families) for (const [fam, s] of Object.entries(e.families)) block(`${part} · family ${fam}`, s);
		const flagged = e.legs.filter((l) => l.events.floor || l.events.readOnlyShell || l.events.compactions || l.events.abandoned || (l.extraCalls && l.extraCalls !== "0") || l.void);
		if (flagged.length > 0) {
			lines.push(`#### ${part} — reported per leg`, "", "| leg | void | floor | read-only shell | compactions | abandoned drafts | extra calls | served model | wire effort |", "|---|---|---:|---:|---:|---:|---:|---|---|");
			for (const l of flagged) lines.push(`| ${l.leg} | ${l.void ? "VOID" : ""} | ${l.events.floor} | ${l.events.readOnlyShell} | ${l.events.compactions} | ${l.events.abandoned} | ${l.extraCalls ?? "?"} | ${JSON.stringify(l.servedModel)} | ${l.effortWire} |`);
			lines.push("");
		}
	}
	return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const [root, round, flag] = process.argv.slice(2);
	if (!root || !round) {
		process.stderr.write("usage: launch-report.mjs <runs root> <round> [--json]\n");
		process.exit(2);
	}
	const r = report(root, round);
	process.stdout.write(flag === "--json" ? `${JSON.stringify(r, null, 1)}\n` : `${markdown(r)}\n`);
}
