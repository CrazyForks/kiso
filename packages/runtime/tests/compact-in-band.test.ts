/**
 * ADR-0055 A2 — /compact (session.summarize) asks for its checkpoint
 * IN-BAND, on the prefix a run sends, with ONE fallback to the serialised
 * form. The lead's ruling on the gap A1b left: a serialised /compact pays
 * the whole context at the miss price, about 50× the in-band call.
 *
 * The proof is the request itself. The summary call's system prompt and
 * tool table are the ones the NEXT run sends, its messages are the
 * session's projection, and its last message is the instruction.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { defineTool, type Adapter, type Message, type StreamOptions } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { SUMMARY_IN_BAND, SUMMARY_PROMPT } from "../src/summarize.js";

const VALID_SUMMARY = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "none", "## Current work", "w", "## Next steps", "n"].join("\n");
const say = (text: string) => ({ events: [{ type: "text_delta" as const, text }, { type: "stop" as const, reason: "end_turn" as const }] });

const readFile = defineTool({
	name: "read_file",
	description: "read",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	execute: async () => ({ content: "x", isError: false }),
});

/** Six user turns, each with a read round — enough rounds for /compact. */
async function seed(store: SessionStore): Promise<void> {
	let seq = 0;
	for (let i = 0; i < 6; i++) {
		await store.append("s", `r${i}`, { seq: seq++, type: "user_input", content: `turn ${i}` });
		await store.append("s", `r${i}`, { seq: seq++, type: "tool_call_end", callId: `c${i}`, name: "read_file", input: { path: `f${i}.ts` } });
		await store.append("s", `r${i}`, { seq: seq++, type: "stop", reason: "tool_use" });
		await store.append("s", `r${i}`, { seq: seq++, type: "tool_result", callId: `c${i}`, content: "line\n".repeat(100), isError: false });
		await store.append("s", `r${i}`, { seq: seq++, type: "text_delta", text: `done ${i}` });
		await store.append("s", `r${i}`, { seq: seq++, type: "stop", reason: "end_turn" });
		await store.append("s", `r${i}`, { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
	}
}

async function sessionWith(script: FauxScript) {
	const dir = mkdtempSync(join(tmpdir(), "kiso-compact-ib-"));
	const store = new SessionStore(dir);
	await seed(store);
	const faux = createFauxProvider(script);
	const requests: StreamOptions[] = [];
	const adapter = { stream: (opts: StreamOptions) => (requests.push(opts), faux.stream(opts)) } as Adapter;
	const agent = createAgent({ model: "faux", store, tools: [readFile], adapter, systemPrompt: "you are a test agent" });
	const session = await agent.session({ id: "s" });
	const ledger = () =>
		readFileSync(join(dir, "traces", "s.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Record<string, unknown>)
			.filter((l) => l.kind === "summary");
	return { session, requests, ledger };
}

describe("/compact asks in-band, on the prefix a run sends", () => {
	it("the summary request carries the run's system prompt and tools, the projection, and the instruction last", async () => {
		const { session, requests } = await sessionWith([
			{ events: [{ type: "text_delta", text: VALID_SUMMARY }, { type: "usage", inputTokens: 900, outputTokens: 50, cacheRead: 800, cacheWrite: null, known: true }, { type: "stop", reason: "end_turn" }] },
			say("next"),
		]);
		const projected = JSON.stringify(session.projected());
		const result = await session.summarize({ manualBudget: true });
		expect(result).not.toBeNull();
		for await (const _ of session.run("go on")) {
			// the run after it: its request is the reference prefix
		}
		const [summary, run] = requests;
		expect(summary!.systemPrompt).not.toBe(SUMMARY_PROMPT);
		expect(summary!.systemPrompt).toBe(run!.systemPrompt);
		expect(JSON.stringify(summary!.tools)).toBe(JSON.stringify(run!.tools));
		expect(JSON.stringify(summary!.messages.slice(0, -1))).toBe(projected);
		const last = summary!.messages.at(-1) as Message;
		expect(last.role === "user" && last.content).toBe(SUMMARY_IN_BAND);
	});

	it("the ledger records the in-band path", async () => {
		const { session, ledger } = await sessionWith([
			{ events: [{ type: "text_delta", text: VALID_SUMMARY }, { type: "usage", inputTokens: 900, outputTokens: 50, cacheRead: 800, cacheWrite: null, known: true }, { type: "stop", reason: "end_turn" }] },
		]);
		await session.summarize({ manualBudget: true });
		expect(ledger()).toEqual([expect.objectContaining({ path: "in-band" })]);
	});

	it("a focus rides the instruction", async () => {
		const { session, requests } = await sessionWith([say(VALID_SUMMARY)]);
		await session.summarize({ manualBudget: true, focus: "the parser" });
		const last = requests[0]!.messages.at(-1) as Message;
		expect(last.role === "user" && last.content).toBe(`${SUMMARY_IN_BAND}\n\nFocus the summary on: the parser`);
	});

	it("an in-band reply that calls a tool is rejected; the serialised form runs once and lands", async () => {
		const { session, requests, ledger } = await sessionWith([
			{ events: [{ type: "tool_call_end", callId: "bad", name: "read_file", input: { path: "y" } }, { type: "stop", reason: "tool_use" }] },
			{ events: [{ type: "text_delta", text: VALID_SUMMARY }, { type: "usage", inputTokens: 900, outputTokens: 50, cacheRead: 0, cacheWrite: null, known: true }, { type: "stop", reason: "end_turn" }] },
		]);
		const result = await session.summarize({ manualBudget: true });
		expect(result).not.toBeNull();
		expect(requests).toHaveLength(2);
		expect(requests[1]!.systemPrompt).toBe(SUMMARY_PROMPT);
		expect(ledger()).toEqual([expect.objectContaining({ path: "serialized" })]);
	});
});

describe("the owner's dogfood — /compact on a long autonomous session", () => {
	it("few user turns, many tool rounds: /compact cuts at a settled round instead of saying 'fewer than 5 rounds'", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiso-compact-long-"));
		const store = new SessionStore(dir);
		let seq = 0;
		const big = "a long line of source text\n".repeat(400); // ~2.7k tokens a result
		for (let turn = 0; turn < 2; turn++) {
			await store.append("s", `r${turn}`, { seq: seq++, type: "user_input", content: `task ${turn}` });
			for (let i = 0; i < 12; i++) {
				const id = `c${turn}-${i}`;
				await store.append("s", `r${turn}`, { seq: seq++, type: "tool_call_end", callId: id, name: "read_file", input: { path: `${id}.ts` } });
				await store.append("s", `r${turn}`, { seq: seq++, type: "stop", reason: "tool_use" });
				await store.append("s", `r${turn}`, { seq: seq++, type: "tool_result", callId: id, content: big, isError: false });
			}
			await store.append("s", `r${turn}`, { seq: seq++, type: "text_delta", text: `done ${turn}` });
			await store.append("s", `r${turn}`, { seq: seq++, type: "stop", reason: "end_turn" });
			await store.append("s", `r${turn}`, { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
		}
		const agent = createAgent({ model: "faux", store, tools: [readFile], adapter: createFauxProvider([say(VALID_SUMMARY)]), systemPrompt: "p" });
		const session = await agent.session({ id: "s" });
		const result = await session.summarize({ manualBudget: true });
		expect(result).not.toBeNull();
		// the cut is a settled round INSIDE the second turn, not a user-turn edge
		const cut = session.log.all.find((e) => e.seq === result!.coversToSeq)!;
		expect(["stop", "tool_result"]).toContain(cut.type);
		expect(store.load("s").filter((r) => r.event.type === "summarized")).toHaveLength(1);
	});
});
