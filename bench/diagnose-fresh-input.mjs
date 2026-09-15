/**
 * WHERE the fresh input goes, per request, per arm, on one task.
 *
 * The T5 finding that motivates this: the cost gap is in FRESH INPUT, not
 * in thinking — we reason LESS than the reference implementation in two of
 * three pairs and cost more in all three. So "it thinks too much" is not
 * the explanation and the money has to be found somewhere else.
 *
 * This reports, and does not explain. Every column is read from a leg's own
 * record; the one estimate is labelled as one. No hypotheses in the output.
 *
 * WHAT IS EXACT: fresh input, cache-read, output and reasoning per request
 * (both arms report all four); which tools ran between two requests; and
 * whether the cached prefix SHRANK from one request to the next, which is
 * what a cache break looks like from outside.
 *
 * WHAT IS ESTIMATED: the size a tool result contributed. The logs carry the
 * result TEXT, not the tokens it became, so characters are reported as
 * characters. Dividing by four would put a fake precision on the one column
 * that most invites it.
 *
 * WHAT CANNOT BE SEPARATED HERE: fresh input is a single number per
 * request. Whether a given fresh token is a tool result, replayed output or
 * replayed reasoning is not in any log — only the REQUEST BODY would say,
 * and no arm records one. So the decomposition is by ATTRIBUTION: what was
 * added between two requests, beside how much fresh input the later one
 * carried. Anything stronger would be invention.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const base = (p) => String(p ?? "").replace(/^.*\//, "");

/** kiso: the durable session log. */
function kisoSeries(leg) {
	const dir = join(leg, "kiso-home", "sessions");
	const f = join(dir, readdirSync(dir).find((x) => x.endsWith(".jsonl") && !x.includes("trace")));
	const names = new Map(), args = new Map();
	const reqs = [];
	let pending = [];      // tools that ran since the last usage event
	let turn = 0;
	let summarised = 0;
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line.trim()) continue;
		let o;
		try { o = JSON.parse(line); } catch { continue; }
		const e = o.event ?? o;
		if (e.type === "user_input") turn += 1;
		else if (e.type === "summarized") summarised += 1;
		else if (e.type === "tool_call_start") {
			names.set(e.callId, e.name);
			args.set(e.callId, "");
		} else if (e.type === "tool_call_input_delta") {
			if (args.has(e.callId)) args.set(e.callId, args.get(e.callId) + (e.inputJsonDelta ?? ""));
		} else if (e.type === "tool_result") {
			let a = {};
			try { a = JSON.parse(args.get(e.callId) ?? "{}"); } catch { /* truncated */ }
			pending.push({
				tool: names.get(e.callId) ?? "?",
				path: base(a.path ?? a.file),
				chars: String(e.content ?? "").length,
				failed: !!e.isError,
			});
		} else if (e.type === "usage") {
			const known = e.known !== false && e.inputTokens !== null && e.cacheRead !== null;
			reqs.push({
				turn,
				known,
				fresh: known ? e.inputTokens - e.cacheRead : null,
				cacheRead: known ? e.cacheRead : null,
				output: known ? e.outputTokens : null,
				reasoning: typeof e.reasoningTokens === "number" ? e.reasoningTokens : null,
				before: pending,
			});
			pending = [];
		}
	}
	return { reqs, summarised };
}

/** the reference implementation: one stdout-N.log per turn. */
function piSeries(leg) {
	const files = readdirSync(leg).filter((x) => /^stdout-\d+\.log$/.test(x))
		.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
	const reqs = [];
	let pending = [];
	for (const file of files) {
		const turn = Number(file.match(/\d+/)[0]);
		for (const line of readFileSync(join(leg, file), "utf8").split("\n")) {
			if (!line.trim()) continue;
			let o;
			try { o = JSON.parse(line); } catch { continue; }
			if (o.type === "tool_execution_end") {
				const text = JSON.stringify(o.result?.content ?? o.result ?? "");
				pending.push({
					tool: String(o.toolName ?? "?").toLowerCase(),
					path: base(o.args?.path ?? o.args?.file_path),
					chars: text.length,
					failed: !!(o.isError || o.result?.isError),
				});
			} else if (o.type === "message_end") {
				const m = o.message ?? {};
				if (m.role !== "assistant") continue;
				const u = m.usage;
				const known = u && typeof u.input === "number";
				reqs.push({
					turn,
					known: !!known,
					// this arm reports input FRESH-ONLY; its cache read is separate
					fresh: known ? u.input : null,
					cacheRead: known ? (u.cacheRead ?? 0) : null,
					output: known ? u.output : null,
					reasoning: known && typeof u.reasoning === "number" ? u.reasoning : null,
					before: pending,
				});
				pending = [];
			}
		}
	}
	return { reqs, summarised: 0 };
}

export function series(leg) {
	if (!existsSync(leg)) return null;
	return existsSync(join(leg, "kiso-home")) ? kisoSeries(leg) : piSeries(leg);
}

/** A cache break seen from outside: the cached prefix SHRANK. */
export function summarise(s) {
	const r = s.reqs.filter((x) => x.known);
	const byTool = {};
	let toolChars = 0, breaks = [], freshTotal = 0, outTotal = 0, rsnTotal = 0;
	for (let i = 0; i < r.length; i += 1) {
		freshTotal += r[i].fresh;
		outTotal += r[i].output;
		rsnTotal += r[i].reasoning ?? 0;
		for (const t of r[i].before) {
			byTool[t.tool] = byTool[t.tool] ?? { calls: 0, chars: 0, failed: 0 };
			byTool[t.tool].calls += 1;
			byTool[t.tool].chars += t.chars;
			if (t.failed) byTool[t.tool].failed += 1;
			toolChars += t.chars;
		}
		if (i > 0 && r[i].cacheRead < r[i - 1].cacheRead) {
			breaks.push({
				at: i + 1,
				turn: r[i].turn,
				from: r[i - 1].cacheRead,
				to: r[i].cacheRead,
				lost: r[i - 1].cacheRead - r[i].cacheRead,
				fresh: r[i].fresh,
				after: r[i].before.map((t) => t.tool).join(",") || "(nothing between)",
			});
		}
	}
	const turns = new Set(r.map((x) => x.turn)).size;
	return {
		requests: r.length,
		unknown: s.reqs.length - r.length,
		turns,
		requestsPerTurn: turns ? r.length / turns : null,
		toolCalls: Object.values(byTool).reduce((a, b) => a + b.calls, 0),
		toolCallsPerTurn: turns ? Object.values(byTool).reduce((a, b) => a + b.calls, 0) / turns : null,
		freshTotal, outTotal, rsnTotal,
		freshPerRequest: r.length ? freshTotal / r.length : null,
		toolChars,
		toolCharsPerTurn: turns ? toolChars / turns : null,
		byTool,
		breaks,
		summarised: s.summarised,
	};
}
