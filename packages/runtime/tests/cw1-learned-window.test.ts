/**
 * CW-1 batch 2 — a route's real window, read from its own refusal.
 *
 * d4fc (2026-09-22) died on a refusal that STATED the cap: "maximum context
 * length is 1048576 tokens". The kernel compacts once and retries once on
 * context_overflow, but the compaction aimed at whatever window the tiers
 * held. Batch 1 gives an unregistered route the MODEL's window — a relay
 * may cap lower — so the refusal's figure is what the tiers must take.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { defineTool, type Adapter, type AdapterEvent, type StreamOptions } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { overflowCap, windowLearner } from "../src/window-learner.js";

/** d4fc's refusal, verbatim. */
const D4FC =
	"[deepseek] request failed: Streaming response failed: [400] This model's maximum context length is 1048576 tokens. However, you requested 131072 output tokens and your prompt contains at least 917505 input tokens, for a total of at least 1048577 tokens. Please reduce the length of the input prompt or the number of requested output tokens. (parameter=input_tokens, value=917505)";

describe("overflowCap — the cap a refusal states, or null", () => {
	it("the two wordings, as providers send them", () => {
		expect(overflowCap(D4FC)).toBe(1_048_576);
		expect(overflowCap("This model's maximum context length is 128000 tokens. However, your messages resulted in 130021 tokens. Please reduce the length of the messages.")).toBe(128_000);
		expect(overflowCap("prompt is too long: 210432 tokens > 200000 maximum")).toBe(200_000);
	});

	it("property: any figure, plain or grouped, in either wording, reads back exactly", () => {
		let seed = 20260923;
		const next = (): number => {
			seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
			return seed;
		};
		for (let i = 0; i < 500; i++) {
			const n = 1_000 + (next() % 50_000_000);
			const forms = [String(n), n.toLocaleString("en-US"), n.toLocaleString("en-US").replace(/,/g, "_")];
			const form = forms[next() % forms.length]!;
			const other = n + 1 + (next() % 10_000);
			const text = next() % 2 === 0 ? `Error: This model's maximum context length is ${form} tokens. However, you requested ${other} tokens.` : `invalid_request_error: prompt is too long: ${other} tokens > ${form} maximum`;
			expect(overflowCap(text), text).toBe(n);
		}
	});

	it("no figure, no cap — never a guess", () => {
		for (const text of [
			"[deepseek] request failed: 500 Internal server error",
			"context_length_exceeded",
			"maximum context length exceeded",
			"the request carried ~1040000 tokens against a stated 1048576-token window less a 131072-token output reserve; it could not fit",
			"This model's maximum context length is 12 tokens", // below any real window: a misread
			"This model's maximum context length is 900000000000 tokens", // above any real window
		]) {
			expect(overflowCap(text), text).toBeNull();
		}
	});
});

async function* fromEvents(events: readonly AdapterEvent[]): AsyncIterable<AdapterEvent> {
	for (const e of events) yield e;
}
const refusing = (err: unknown): Adapter => ({
	// eslint-disable-next-line require-yield
	stream: async function* () {
		throw err;
	},
});

describe("windowLearner — reports a stated cap once, and changes nothing else", () => {
	it("the SAME error is rethrown, after one report", async () => {
		const err = { code: "context_overflow", retryable: false, message: D4FC };
		const caps: number[] = [];
		const wrapped = windowLearner(refusing(err), (t) => caps.push(t));
		let caught: unknown;
		try {
			for await (const _ of wrapped.stream({ model: "m", messages: [] } as StreamOptions)) {
				// nothing arrives
			}
		} catch (e) {
			caught = e;
		}
		expect(caught).toBe(err);
		expect(caps).toEqual([1_048_576]);
	});

	it("an error that states no cap, a success, and a caller's abort report nothing", async () => {
		const caps: number[] = [];
		const onCap = (t: number) => caps.push(t);
		await expect(async () => {
			for await (const _ of windowLearner(refusing({ code: "api_5xx", retryable: true, message: "500 Internal server error" }), onCap).stream({ model: "m", messages: [] } as StreamOptions)) {
				// nothing
			}
		}).rejects.toBeDefined();
		const ok: AdapterEvent[] = [];
		for await (const e of windowLearner({ stream: () => fromEvents([{ seq: 0, type: "text_delta", text: "hi" }]) }, onCap).stream({ model: "m", messages: [] } as StreamOptions)) ok.push(e);
		expect(ok).toEqual([{ seq: 0, type: "text_delta", text: "hi" }]);
		const aborted = new AbortController();
		aborted.abort();
		await expect(async () => {
			for await (const _ of windowLearner(refusing({ code: "context_overflow", retryable: false, message: D4FC }), onCap).stream({ model: "m", messages: [], signal: aborted.signal } as StreamOptions)) {
				// nothing
			}
		}).rejects.toBeDefined();
		expect(caps).toEqual([]);
	});
});

// ── in a run ────────────────────────────────────────────────────────────────

const VALID_SUMMARY = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "none", "## Current work", "w", "## Next steps", "n"].join("\n");
const BIG = "line of source text\n".repeat(2_000); // 40k chars, ~10k tokens

const readFile = defineTool({
	name: "read_file",
	description: "read",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	execute: async () => ({ content: BIG, isError: false }),
});

async function seed(store: SessionStore, rounds: number): Promise<void> {
	let seq = 0;
	await store.append("s", "r1", { seq: seq++, type: "user_input", content: "work through the repo" });
	for (let i = 0; i < rounds; i++) {
		await store.append("s", "r1", { seq: seq++, type: "tool_call_end", callId: `s${i}`, name: "read_file", input: { path: `f${i}.ts` } });
		await store.append("s", "r1", { seq: seq++, type: "stop", reason: "tool_use" });
		await store.append("s", "r1", { seq: seq++, type: "tool_result", callId: `s${i}`, content: BIG, isError: false });
	}
	await store.append("s", "r1", { seq: seq++, type: "text_delta", text: "read them all" });
	await store.append("s", "r1", { seq: seq++, type: "stop", reason: "end_turn" });
	await store.append("s", "r1", { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
}

const usage = (inputTokens: number) => ({ type: "usage" as const, inputTokens, outputTokens: 200, cacheRead: inputTokens - 100, cacheWrite: null, known: true });
const call = (callId: string, billed: number) => ({
	events: [{ type: "tool_call_end" as const, callId, name: "read_file", input: { path: `${callId}.ts` } }, usage(billed), { type: "stop" as const, reason: "tool_use" as const }],
});
const say = (text: string) => ({ events: [{ type: "text_delta" as const, text }, { type: "stop" as const, reason: "end_turn" as const }] });
/** A relay that caps a 1M model at 131,072 — the refusal states it. */
const REFUSE_STATED = {
	events: [{ type: "fail" as const, code: "context_overflow", status: 400, retryable: false, message: "This model's maximum context length is 131072 tokens. However, you requested 8000 output tokens and your prompt contains at least 130000 input tokens." }],
};
/** The same refusal with no figure in it. */
const REFUSE_BARE = { events: [{ type: "fail" as const, code: "context_overflow", status: 400, retryable: false, message: "context_length_exceeded" }] };

async function runWith(script: FauxScript) {
	const dir = mkdtempSync(join(tmpdir(), "kiso-cw1-learned-"));
	const store = new SessionStore(dir);
	await seed(store, 5);
	const faux = createFauxProvider(script);
	const requests: StreamOptions[] = [];
	const adapter = { stream: (opts: StreamOptions) => (requests.push(opts), faux.stream(opts)) } as Adapter;
	const learned: { tokens: number; model: string; baseUrl?: string }[] = [];
	const agent = createAgent({
		model: "faux",
		store,
		tools: [readFile],
		adapter,
		systemPrompt: "you are a test agent",
		maxTokens: 8_000,
		// the window batch 1 would give an unregistered relay of a 1M model
		contextPolicy: { tiers: { windowTokens: 1_048_576, onWindowLearned: (w) => learned.push({ ...w }) } },
	});
	const session = await agent.session({ id: "s" });
	for await (const _ of session.run("continue")) {
		// the run lands in the log
	}
	const ledger = readFileSync(join(dir, "traces", "s.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
	const events = store.load("s").map((r) => r.event);
	const outcome = (events.filter((e) => e.type === "terminal").at(-1) as { outcome: { kind: string; error?: { code: string } } } | undefined)?.outcome;
	return { requests, learned, ledger, events, outcome };
}

describe("in a run: the kernel's one overflow compaction aims at the STATED cap", () => {
	it("the refusal states 131,072: the tiers take it, the compaction covers the old rounds, the retry completes", async () => {
		const { learned, ledger, events, outcome } = await runWith([call("c1", 60_000), REFUSE_STATED, say(VALID_SUMMARY), say("done")]);
		expect(learned).toEqual([{ tokens: 131_072, model: "faux" }]);
		expect(events.filter((e) => e.type === "summarized")).toHaveLength(1);
		expect(ledger.filter((l) => l.kind === "summary")).toEqual([expect.objectContaining({ reason: "overflow" })]);
		expect(outcome?.kind).toBe("completed");
	});

	it("control — the same refusal with no figure: the tiers keep the 1M window, whose tail holds the whole context, so nothing is covered and the run ends on the overflow", async () => {
		const { learned, events, outcome } = await runWith([call("c1", 60_000), REFUSE_BARE, say(VALID_SUMMARY), say("done")]);
		expect(learned).toEqual([]);
		expect(events.filter((e) => e.type === "summarized")).toHaveLength(0);
		expect(outcome?.kind).toBe("error");
		expect(outcome?.error?.code).toBe("context_overflow");
	});
});
