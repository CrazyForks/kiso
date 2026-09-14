#!/usr/bin/env node
/**
 * WHERE THE TOKENS ACTUALLY WENT, over sessions nobody staged.
 *
 * Phase 1 of the round that replaced the threshold experiment. The survey
 * showed the compaction threshold has never fired in real use — 0 of 78
 * sessions reached 100,000, the highest was 53,475 — so before paying for
 * another paired round it is worth decomposing the bill we have already
 * paid, and letting the decomposition name the next lever. PR-1c found its
 * answer this way: the regression was in reasoning tokens, 73% of output,
 * and that came out of a decomposition rather than an A/B.
 *
 * WHAT THE DATA SUPPORTS, checked before it was used:
 *   - `canonical` is present on all 841 recorded requests: fresh input,
 *     cache read, cache write, output.
 *   - `rent` is present on all of them: the per-request FIXED overhead,
 *     broken out by surface — the system prompt, each tool's schema, the
 *     continuation envelope. The conversation itself is not in rent, so
 *     rent over total input is the share of every request that is tax
 *     rather than content.
 *   - `canonical.reasoning` is null on ALL 841. Reasoning tokens are NOT
 *     separable from the usage here, and this tool does not pretend they
 *     are. The thinking share below is a CHARACTER proxy taken from the
 *     session log's own `thinking` and `text_delta` events, labelled as
 *     one everywhere it appears.
 *   - `costUsd` is non-null on 49 of 841 — only the models whose pricing
 *     is registered. Money is reported for those and left blank elsewhere,
 *     because the registry records unknown pricing as null on purpose.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { isMain } from "../scripts/is-main.mjs";

const COST_EQ = (F, H, O) => F + 0.02 * H + 4 * O;

/** The character proxy for thinking, from the durable log. Never called a token count. */
function thinkingProxy(sessionsDir, id) {
	const f = join(sessionsDir, `${id}.jsonl`);
	if (!existsSync(f)) return null;
	let think = 0, text = 0;
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		let rec; try { rec = JSON.parse(line); } catch { continue; }
		const e = rec.event ?? rec;
		if (e.type === "thinking") think += (e.text ?? e.delta ?? "").length;
		else if (e.type === "text_delta") text += (e.text ?? e.delta ?? "").length;
	}
	return { thinkChars: think, textChars: text };
}

export function anatomy(sessionsDir) {
	const tracesDir = join(sessionsDir, "traces");
	const rows = [];
	for (const f of readdirSync(tracesDir).filter((x) => x.endsWith(".jsonl") && !x.startsWith("sub-"))) {
		const id = basename(f, ".jsonl");
		let F = 0, H = 0, W = 0, O = 0, n = 0, usd = 0, usdKnown = 0;
		const rent = { system: 0, tool: 0, envelope: 0 };
		let rentReqs = 0;
		const models = new Set();
		for (const line of readFileSync(join(tracesDir, f), "utf8").split("\n")) {
			if (line.trim() === "") continue;
			let e; try { e = JSON.parse(line); } catch { continue; }
			if (e.kind !== "request") continue;
			const c = e.canonical ?? {};
			n++; models.add(e.model);
			F += c.input ?? 0; H += c.cacheRead ?? 0; W += c.cacheWrite ?? 0; O += c.output ?? 0;
			if (c.costUsd != null) { usd += c.costUsd; usdKnown++; }
			if (Array.isArray(e.rent)) {
				rentReqs++;
				for (const r of e.rent) {
					const fam = r.surface.split(":")[0];
					if (fam in rent) rent[fam] += r.estTokens ?? 0;
				}
			}
		}
		if (n === 0) continue;
		const rentTotal = rent.system + rent.tool + rent.envelope;
		rows.push({
			id, requests: n, models: [...models],
			fresh: F, cacheRead: H, cacheWrite: W, output: O,
			costEq: COST_EQ(F, H, O),
			rentPerRequest: rentReqs ? Math.round(rentTotal / rentReqs) : 0,
			rentSystem: rentReqs ? Math.round(rent.system / rentReqs) : 0,
			rentTools: rentReqs ? Math.round(rent.tool / rentReqs) : 0,
			rentEnvelope: rentReqs ? Math.round(rent.envelope / rentReqs) : 0,
			usd: usdKnown === n ? usd : null,
			thinking: thinkingProxy(sessionsDir, id),
		});
	}
	return rows.sort((a, b) => b.costEq - a.costEq);
}

if (isMain(import.meta.url)) {
	const dir = process.argv[2];
	if (dir === undefined) { console.error("usage: cost-anatomy.mjs <sessions-dir>"); process.exit(2); }
	const rows = anatomy(dir);
	const sum = (k) => rows.reduce((a, b) => a + (b[k] ?? 0), 0);
	const F = sum("fresh"), H = sum("cacheRead"), O = sum("output"), R = sum("requests");
	const eq = COST_EQ(F, H, O);
	console.log(`sessions with usage: ${rows.length}   requests: ${R}\n`);
	console.log("THE BILL, as cost_equivalent = F + 0.02H + 4O");
	console.log(`  fresh input   F = ${F.toLocaleString().padStart(12)}   ${(100*F/eq).toFixed(1)}% of cost_eq`);
	console.log(`  cache read    H = ${H.toLocaleString().padStart(12)}   ${(100*0.02*H/eq).toFixed(1)}%`);
	console.log(`  output        O = ${O.toLocaleString().padStart(12)}   ${(100*4*O/eq).toFixed(1)}%`);
	console.log(`  total cost_eq   = ${Math.round(eq).toLocaleString()}`);
	console.log(`  cache hit rate  = ${(100*H/(F+H)).toFixed(1)}% of all input tokens`);

	const withRent = rows.filter((r) => r.rentPerRequest > 0);
	const avg = (k) => Math.round(withRent.reduce((a, b) => a + b[k], 0) / withRent.length);
	console.log(`\nTHE FIXED OVERHEAD, per request, averaged over ${withRent.length} sessions`);
	console.log(`  system prompt        ${String(avg("rentSystem")).padStart(6)} tok`);
	console.log(`  tool schemas         ${String(avg("rentTools")).padStart(6)} tok`);
	console.log(`  continuation envelope${String(avg("rentEnvelope")).padStart(6)} tok`);
	console.log(`  total floor          ${String(avg("rentPerRequest")).padStart(6)} tok per request, before any conversation`);
	console.log(`  that floor as a share of all input: ${(100 * avg("rentPerRequest") * R / (F + H)).toFixed(1)}%`);

	const th = rows.filter((r) => r.thinking && (r.thinking.thinkChars + r.thinking.textChars) > 0);
	const tc = th.reduce((a, b) => a + b.thinking.thinkChars, 0);
	const xc = th.reduce((a, b) => a + b.thinking.textChars, 0);
	console.log(`\nTHINKING, a CHARACTER PROXY (canonical.reasoning is null on every request)`);
	console.log(`  thinking chars ${tc.toLocaleString()}   visible text chars ${xc.toLocaleString()}`);
	console.log(`  thinking is ${(100*tc/(tc+xc)).toFixed(1)}% of generated characters across ${th.length} sessions`);

	console.log(`\nTHE TEN MOST EXPENSIVE SESSIONS`);
	for (const r of rows.slice(0, 10)) {
		const t = r.thinking && (r.thinking.thinkChars + r.thinking.textChars) > 0
			? `${(100*r.thinking.thinkChars/(r.thinking.thinkChars+r.thinking.textChars)).toFixed(0)}%` : "  -";
		console.log(`  cost_eq ${String(Math.round(r.costEq)).padStart(9)}  reqs ${String(r.requests).padStart(4)}  floor/req ${String(r.rentPerRequest).padStart(5)}  think ${t.padStart(4)}  ${r.id}`);
	}
}
