/**
 * What the FRESH input is made of — by differencing consecutive requests.
 *
 * THE ANALYTICAL POINT, and the thing I got wrong on first look: a request
 * body carries the WHOLE conversation, so the body's composition is not
 * the fresh input's composition. Fresh is what the cache did NOT serve —
 * the tail, what was ADDED since the previous request. So the question
 * "what is the fat" is answered by differencing consecutive bodies, not by
 * measuring one.
 *
 * Reading a single body's role shares would have said "70% is the
 * assistant's own previous output", which is true of the payload and says
 * nothing about the bill: almost all of that 70% is cached prefix. The
 * delta is where the money is.
 *
 * WHAT IS EXACT: which messages appeared between two requests, their
 * roles, their byte sizes, and whether they carry replayed reasoning.
 * WHAT IS ESTIMATED: nothing here is converted to tokens. Bytes are
 * reported as bytes; the usage record's fresh count is reported beside
 * them, and the two are correlated rather than equated.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readCapture } from "./reconcile-capture.mjs";

const bytes = (o) => Buffer.byteLength(JSON.stringify(o ?? ""), "utf8");

/** Reasoning replayed INTO a request — the vendor requires it on
 *  tool-carrying turns, so it is a cost neither arm chooses. */
function reasoningBytes(m) {
	let n = 0;
	for (const k of ["reasoning_content", "reasoning", "thinking"]) {
		if (m && m[k] !== undefined && m[k] !== null) n += bytes(m[k]);
	}
	return n;
}

/** One class per added message, in the vocabulary the question is asked in. */
function classify(m) {
	const role = m?.role;
	if (role === "tool") return "tool result";
	if (role === "user") return "user turn";
	if (role === "system") return "system";
	if (role === "assistant") return (m.tool_calls?.length ?? 0) > 0 ? "our tool call" : "our text";
	return `other:${role}`;
}

/**
 * The per-request deltas for one leg.
 * Messages are matched by POSITION: a request's messages are the previous
 * request's plus what followed. A body that is SHORTER than its predecessor
 * is a compaction or a new session — reported as a reset, never differenced.
 */
export function deltas(captureDir) {
	const recs = readCapture(captureDir);
	if (recs === null) return null;
	const calls = recs.filter((r) => r.body?.messages);
	const out = [];
	for (let i = 0; i < calls.length; i += 1) {
		const msgs = calls[i].body.messages;
		const prev = i > 0 ? calls[i - 1].body.messages : [];
		if (i > 0 && msgs.length < prev.length) {
			out.push({ index: i + 1, reset: true, total: bytes(msgs), added: [] });
			continue;
		}
		const added = msgs.slice(prev.length);
		out.push({
			index: i + 1,
			reset: false,
			total: bytes(msgs),
			added: added.map((m) => {
				const r = reasoningBytes(m);
				const b = bytes(m);
				// WITHIN a tool-calling message, the mandated replay and the
				// arguments we chose to send are DIFFERENT KINDS of cost: one
				// is the vendor's requirement on tool-carrying turns and
				// nobody's to remove, the other is our tool schema. Rolling
				// them into one number makes the fat look unfixable.
				const args = (m.tool_calls ?? []).reduce((a, c) => a + bytes(c.function?.arguments ?? c), 0);
				return { cls: classify(m), bytes: b, reasoning: r, toolArgs: args, rest: b - r - args };
			}),
		});
	}
	return out;
}

/** Sum a leg's deltas into the shares the question asks for. */
export function compose(captureDir) {
	const d = deltas(captureDir);
	if (d === null) return null;
	const byClass = {};
	let addedTotal = 0, reasoningTotal = 0, argsTotal = 0, restTotal = 0, resets = 0;
	for (const r of d) {
		if (r.reset) { resets += 1; continue; }
		for (const a of r.added) {
			byClass[a.cls] = (byClass[a.cls] ?? 0) + a.bytes;
			addedTotal += a.bytes;
			reasoningTotal += a.reasoning;
			argsTotal += a.toolArgs;
			restTotal += a.rest;
		}
	}
	return {
		requests: d.length,
		resets,
		addedTotal,
		// replayed reasoning is a SLICE of the assistant messages above, not
		// a sibling class — reported separately so it is never double-counted
		reasoningWithinAdded: reasoningTotal,
		toolArgsWithinAdded: argsTotal,
		everythingElseWithinAdded: restTotal,
		byClass,
		firstBodyBytes: d[0]?.total ?? null,
		lastBodyBytes: d[d.length - 1]?.total ?? null,
	};
}
