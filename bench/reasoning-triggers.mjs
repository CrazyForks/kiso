/**
 * What PRECEDES a request, against how much the model reasons in it.
 *
 * The table of where the fresh bytes go can say "the excess is reasoning".
 * That is an attribution and not a fix: reasoning VOLUME is the model's
 * decision (effort is a ceiling, not a floor), and nothing in our loop
 * sets it directly. A TRIGGER is different — if the model reasons twice as
 * much after a failed edit, or after a tool result above some size, that is
 * a shape we control and can change.
 *
 * So each request is joined to what happened immediately before it: which
 * tool ran, how big its result was, whether it errored, and how large the
 * conversation already was. Both arms, same task.
 *
 * ALIGNMENT, and its one assumption: the Nth captured body is the Nth
 * recorded usage event. Both are appended in request order by the same
 * process, and reconcile-capture has already gated that the two counts
 * MATCH — a leg where they do not is not analysed here at all, because a
 * silent off-by-one would attribute every request's reasoning to the wrong
 * predecessor and the result would look like a finding.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readCapture } from "./reconcile-capture.mjs";

const bytes = (o) => Buffer.byteLength(JSON.stringify(o ?? ""), "utf8");

/** Our arm's usage series, in request order. */
function kisoUsage(leg) {
	const dir = join(leg, "kiso-home", "sessions");
	const f = join(dir, readdirSync(dir).find((x) => x.endsWith(".jsonl") && !x.includes("trace")));
	const out = [];
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line.trim()) continue;
		let o;
		try { o = JSON.parse(line); } catch { continue; }
		const e = o.event ?? o;
		if (e.type !== "usage") continue;
		out.push({
			reasoning: typeof e.reasoningTokens === "number" ? e.reasoningTokens : null,
			fresh: e.known === false ? null : (e.inputTokens - e.cacheRead),
			cacheRead: e.known === false ? null : e.cacheRead,
		});
	}
	return out;
}

/** The other arm's usage series, in request order. */
function piUsage(leg) {
	const out = [];
	const files = readdirSync(leg).filter((x) => /^stdout-\d+\.log$/.test(x))
		.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
	for (const f of files) {
		for (const line of readFileSync(join(leg, f), "utf8").split("\n")) {
			if (!line.trim()) continue;
			let o;
			try { o = JSON.parse(line); } catch { continue; }
			if (o.type !== "message_end") continue;
			const m = o.message ?? {};
			if (m.role !== "assistant") continue;
			const u = m.usage ?? {};
			out.push({
				reasoning: typeof u.reasoning === "number" ? u.reasoning : null,
				fresh: typeof u.input === "number" ? u.input : null,
				cacheRead: u.cacheRead ?? null,
			});
		}
	}
	return out;
}

/** Resolve a tool result's NAME.
 *
 *  An OpenAI-format tool message carries `tool_call_id` and NOT the tool's
 *  name — the name lives on the assistant message that made the call. Read
 *  naively, every predecessor reads "(unnamed)" and the whole analysis
 *  collapses: "after a read" and "after a shell command" become one bucket,
 *  which is exactly the distinction a trigger would live in.
 */
function toolNameFor(msgs, toolMsg) {
	const id = toolMsg.tool_call_id ?? toolMsg.toolCallId;
	if (id) {
		for (const m of msgs) {
			for (const c of m.tool_calls ?? []) {
				if (c.id === id) return c.function?.name ?? c.name ?? "(unnamed)";
			}
		}
	}
	return toolMsg.name ?? toolMsg.tool_name ?? "(unnamed)";
}

/** What sat immediately before request i, from the messages it added. */
function predecessorOf(added, allMsgs) {
	// walk BACKWARDS: the nearest tool result is what the model just saw
	for (let i = added.length - 1; i >= 0; i -= 1) {
		const m = added[i];
		if (m.role === "tool") {
			const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
			// an error is a property of the RESULT's text; the arms word it
			// differently, so match on both vocabularies rather than ours
			const errored = /\b(error|failed|not found|cannot|refused|denied|no such)\b/i.test(text.slice(0, 400));
			return { kind: "tool result", tool: toolNameFor(allMsgs, m), resultBytes: bytes(text), errored };
		}
		if (m.role === "user") return { kind: "user turn", tool: null, resultBytes: bytes(m.content), errored: false };
	}
	return { kind: "nothing new", tool: null, resultBytes: 0, errored: false };
}

export function triggers(leg, arm) {
	const recs = readCapture(join(leg, "capture"));
	if (recs === null) return null;
	const calls = recs.filter((r) => r.body?.messages);
	const usage = arm === "kiso" ? kisoUsage(leg) : piUsage(leg);
	// THE GATE, not a warning: a count mismatch means every request would be
	// joined to the wrong predecessor, and the output would look like a
	// finding rather than like a misalignment.
	if (calls.length !== usage.length) {
		return { aligned: false, why: `${calls.length} captured bodies against ${usage.length} usage records` };
	}
	const rows = [];
	for (let i = 0; i < calls.length; i += 1) {
		const msgs = calls[i].body.messages;
		const prev = i > 0 ? calls[i - 1].body.messages : [];
		const added = msgs.length >= prev.length ? msgs.slice(prev.length) : [];
		rows.push({
			index: i + 1,
			reasoning: usage[i].reasoning,
			fresh: usage[i].fresh,
			contextBytes: bytes(msgs),
			...predecessorOf(added, msgs),
		});
	}
	return { aligned: true, rows };
}

/** Reasoning grouped by what preceded it — the shape a trigger would show in. */
export function byPredecessor(rows) {
	const g = {};
	for (const r of rows) {
		if (r.reasoning === null) continue;
		const key = r.kind === "tool result" ? `after ${r.tool}${r.errored ? " (ERROR)" : ""}` : `after a ${r.kind}`;
		(g[key] ??= []).push(r.reasoning);
	}
	const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
	return Object.entries(g)
		.map(([k, v]) => ({ predecessor: k, n: v.length, median: median(v), mean: v.reduce((a, b) => a + b, 0) / v.length }))
		.sort((a, b) => b.n - a.n);
}
