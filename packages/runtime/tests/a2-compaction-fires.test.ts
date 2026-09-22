/**
 * ADR-0055 Amendment 2, decision 2 — the SHRINK INVARIANT. A fire is kept
 * only if it removes at least what it writes (post ≤ pre − summary, all
 * chars/4 estimates). A checkpoint that fails it is discarded: nothing is
 * appended, the run continues on the pre-compaction context, the failure
 * counts toward the breaker — at EVERY tier but overflow — and the notice
 * carries sizes only, never the checkpoint's text.
 *
 * The healthy side is the existing a1b-tiers suite: every fire there must
 * still land, so a margin that rejected a real replacing fire goes red
 * there.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { defineTool, SUMMARY_FRAMING, type Adapter, type Message, type StreamOptions } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { SUMMARY_IN_BAND } from "../src/summarize.js";
import { outputReserve, tiersFor, UNKNOWN_MAX_OUTPUT } from "../src/compaction-policy.js";

const VALID_SUMMARY = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "none", "## Current work", "w", "## Next steps", "n"].join("\n");
/** A complete checkpoint (it passes validation) that is far larger than
 *  anything it could cover: ~60k tokens by chars/4. */
const BLOATED = `${VALID_SUMMARY}\n${"restated detail ".repeat(15_000)}`;
const BIG = "line of source text\n".repeat(2_000); // 40k chars, ~10k tokens

const readFile = defineTool({
	name: "read_file",
	description: "read",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	execute: async () => ({ content: BIG, isError: false }),
});

/** Settled read rounds of ~10k tokens each (five by default), inside one user turn. */
async function seed(store: SessionStore, rounds = 5): Promise<void> {
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

interface Discard { readonly reason: string; readonly pre: number; readonly post: number; readonly summary: number }

interface RunOptions {
	readonly windowTokens?: number;
	/** Sets the emergency reserve explicitly (the faux model has no registry row). */
	readonly maxTokens?: number;
	readonly seedRounds?: number;
}

async function runWith(script: FauxScript, options: RunOptions = {}) {
	const dir = mkdtempSync(join(tmpdir(), "kiso-a2-fires-"));
	const store = new SessionStore(dir);
	await seed(store, options.seedRounds);
	const faux = createFauxProvider(script);
	const requests: StreamOptions[] = [];
	const adapter = { stream: (opts: StreamOptions) => (requests.push(opts), faux.stream(opts)) } as Adapter;
	const discards: Discard[] = [];
	const agent = createAgent({
		model: "faux",
		store,
		tools: [readFile],
		adapter,
		systemPrompt: "you are a test agent",
		...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
		contextPolicy: { tiers: { windowTokens: options.windowTokens ?? 200_000, onDiscard: (info) => discards.push(info) } },
	});
	const session = await agent.session({ id: "s" });
	for await (const _ of session.run("continue")) {
		// the run lands in the log and the store
	}
	const ledger = readFileSync(join(dir, "traces", "s.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
	return { requests, discards, ledger, events: store.load("s").map((r) => r.event) };
}

const isSummaryCall = (r: StreamOptions): boolean => {
	const last = r.messages.at(-1) as Message | undefined;
	return last?.role === "user" && last.content === SUMMARY_IN_BAND;
};
const carriesSummary = (r: StreamOptions): boolean => r.messages.some((m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith(SUMMARY_FRAMING));

describe("A2 — a checkpoint that does not shrink the context is discarded", () => {
	it("hard tier: nothing appended, the run continues on the pre-fire context, the notice carries sizes only", async () => {
		const { requests, discards, ledger, events } = await runWith([call("c1", 155_000), say(BLOATED), say("done")]);
		// the summary call happened (it was paid) — request #2
		expect(requests.filter(isSummaryCall)).toHaveLength(1);
		// …and nothing it wrote reached the log or the next request
		expect(events.filter((e) => e.type === "summarized")).toHaveLength(0);
		const [first, , next] = requests;
		expect(carriesSummary(next!)).toBe(false);
		expect(JSON.stringify(next!.messages.slice(0, first!.messages.length))).toBe(JSON.stringify(first!.messages));
		expect(next!.messages).toHaveLength(first!.messages.length + 2); // the call and its result
		// the notice: one discard, numbers only, the margin violated
		expect(discards).toHaveLength(1);
		const d = discards[0]!;
		expect(d.reason).toBe("hard");
		expect(Object.values(d).every((v) => typeof v === "number" || v === "hard")).toBe(true);
		expect(d.pre - d.post).toBeLessThan(d.summary);
		// the ledger still records the paid call, marked discarded
		expect(ledger.filter((l) => l.kind === "summary")).toEqual([expect.objectContaining({ reason: "hard", path: "in-band", discarded: "no-shrink" })]);
		expect(events.some((e) => e.type === "terminal" && (e.outcome as { kind: string }).kind === "completed")).toBe(true);
	});

	it("emergency tier: no-shrink failures open the breaker too — after three, no fourth summary is paid for", async () => {
		// window 200K with a stated 32K reserve: hard 160K, emergency 168K.
		// Each round is billed past emergency; every checkpoint is bloated.
		const { requests, discards, events } = await runWith(
			[call("c1", 170_000), say(BLOATED), call("c2", 171_000), say(BLOATED), call("c3", 172_000), say(BLOATED), call("c4", 173_000), say("done")],
			{ maxTokens: 32_000 },
		);
		expect(events.filter((e) => e.type === "summarized")).toHaveLength(0);
		expect(discards.map((d) => d.reason)).toEqual(["emergency", "emergency", "emergency"]);
		// three summary calls, not four: the fourth fire met an open breaker
		expect(requests.filter(isSummaryCall)).toHaveLength(3);
		expect(events.some((e) => e.type === "terminal" && (e.outcome as { kind: string }).kind === "completed")).toBe(true);
	});
});

describe("A2 decision 4 — the emergency reserve is what the endpoint may grant", () => {
	it("maxTokens when kiso sends one, else the registry's max output, else 131,072 — never below the floor", () => {
		expect(outputReserve(undefined, undefined, 32_000)).toBe(UNKNOWN_MAX_OUTPUT);
		expect(outputReserve(undefined, null, 32_000)).toBe(131_072);
		expect(outputReserve(undefined, 384_000, 32_000)).toBe(384_000);
		expect(outputReserve(64_000, 384_000, 32_000)).toBe(64_000);
		expect(outputReserve(8_000, 384_000, 32_000)).toBe(32_000);
	});

	it("an unknown max output on a stated 1,048,576 window puts emergency at 917,504 — the op gateway's limit, exactly", () => {
		// d4fc: "maximum context length is 1048576 … you requested 131072
		// output tokens and your prompt contains at least 917505 input tokens"
		expect(tiersFor(1_048_576, outputReserve(undefined, undefined, 32_000)).emergency).toBe(917_504);
		// the first-party DeepSeek row (384K) keeps emergency at hard, as before
		expect(tiersFor(1_000_000, outputReserve(undefined, 384_000, 32_000)).emergency).toBe(700_000);
	});

	it("in a run: 930K on a 1,048,576 window with no stated output is past emergency, not merely hard", async () => {
		// 0.40.1 reserved 32K here — emergency 1,016,576 — and called this `hard`.
		const { ledger } = await runWith([call("c1", 920_000), say(VALID_SUMMARY), say("done")], { windowTokens: 1_048_576, seedRounds: 15 });
		expect(ledger.filter((l) => l.kind === "summary")).toEqual([expect.objectContaining({ reason: "emergency", path: "in-band" })]);
	});
});
