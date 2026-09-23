/**
 * ADR-0055 Amendment 1 (A1b) — the kernel's compaction point.
 *
 * The kernel keeps no compaction policy: before every request it asks
 * LoopConfig.compact what to append, appends and yields it, and re-derives.
 * On a context overflow it asks ONCE more (why = "overflow") and retries
 * ONCE; nothing returned, or a second overflow, ends the run as before.
 */

import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { ToolRegistry } from "../src/tools/registry.js";
import { defineTool } from "../src/tools/tool.js";
import { EventLog, loop, mapApiError, type Event, type EventInput, type Message } from "../src/index.js";

const readTool = defineTool({
	name: "read_file",
	description: "read",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	execute: async () => ({ content: "contents", isError: false }),
});

async function drain(config: Parameters<typeof loop>[0]): Promise<Event[]> {
	const out: Event[] = [];
	for await (const ev of config.log !== undefined ? loop(config) : loop(config)) out.push(ev);
	return out;
}

const say = (text: string) => ({ events: [{ type: "text_delta" as const, text }, { type: "stop" as const, reason: "end_turn" as const }] });

describe("A1b — the compaction point is asked before EVERY request", () => {
	it("asked once per request, with the log and the messages about to be sent; nothing returned changes nothing", async () => {
		const registry = new ToolRegistry();
		registry.register(readTool);
		const log = new EventLog();
		log.append({ type: "user_input", content: "go" });
		const calls: { why: string; messages: number }[] = [];
		const script: FauxScript = [{ events: [{ type: "tool_call_end", callId: "c1", name: "read_file", input: { path: "a" } }, { type: "stop", reason: "tool_use" }] }, say("done")];
		await drain({
			adapter: createFauxProvider(script),
			model: "faux",
			registry,
			log,
			compact: async (_events, messages, why) => {
				calls.push({ why, messages: messages.length });
				return [];
			},
		});
		expect(calls.map((c) => c.why)).toEqual(["request", "request"]);
		// the second request carries the first turn and its result
		expect(calls[1]!.messages).toBeGreaterThan(calls[0]!.messages);
		expect(log.all.some((e) => e.type === "summarized" || e.type === "microcompacted")).toBe(false);
	});

	it("what it returns is appended durably, yielded, and the request is re-derived from it", async () => {
		const registry = new ToolRegistry();
		const log = new EventLog();
		log.append({ type: "user_input", content: "first" });
		log.append({ type: "text_delta", text: "an old answer" });
		log.append({ type: "stop", reason: "end_turn" });
		log.append({ type: "user_input", content: "second" });
		const seen: Message[][] = [];
		const adapter = createFauxProvider([say("ok")]);
		const recording = { stream: (opts: Parameters<typeof adapter.stream>[0]) => (seen.push([...opts.messages]), adapter.stream(opts)) } as typeof adapter;
		let asked = 0;
		const events = await drain({
			adapter: recording,
			model: "faux",
			registry,
			log,
			compact: async (): Promise<readonly EventInput[]> => (asked++ === 0 ? [{ type: "summarized", coversToSeq: 2, summary: "## Current work\nx\n## Next steps\ny" }] : []),
		});
		expect(events.some((e) => e.type === "summarized")).toBe(true);
		expect(log.all.filter((e) => e.type === "summarized")).toHaveLength(1);
		// the request that went out was derived AFTER the summary: the old
		// answer is gone, the summary stands in its place
		const sent = JSON.stringify(seen[0]);
		expect(sent).not.toContain("an old answer");
		expect(sent).toContain("## Next steps");
	});
});

describe("A1b — overflow: one compaction, one retry", () => {
	const overflowTurn = { events: [{ type: "fail" as const, code: "context_overflow", status: 400, retryable: false, message: "This model's maximum context length is 1000 tokens" }] };

	it("a thrown overflow asks once with why=overflow, then retries once and completes", async () => {
		const registry = new ToolRegistry();
		const log = new EventLog();
		log.append({ type: "user_input", content: "go" });
		const whys: string[] = [];
		const events = await drain({
			adapter: createFauxProvider([overflowTurn, say("recovered")]),
			model: "faux",
			registry,
			log,
			compact: async (_e, _m, why) => {
				whys.push(why);
				return why === "overflow" ? [{ type: "microcompacted", beforeSeq: 0 }] : [];
			},
		});
		expect(whys).toEqual(["request", "overflow"]);
		const terminal = events.find((e) => e.type === "terminal") as { outcome: { kind: string } };
		expect(terminal.outcome.kind).toBe("completed");
	});

	it("a SECOND overflow ends the run on the refusal — never a loop", async () => {
		const registry = new ToolRegistry();
		const log = new EventLog();
		log.append({ type: "user_input", content: "go" });
		const whys: string[] = [];
		const events = await drain({
			adapter: createFauxProvider([overflowTurn, overflowTurn, say("never")]),
			model: "faux",
			registry,
			log,
			compact: async (_e, _m, why) => {
				whys.push(why);
				return why === "overflow" ? [{ type: "microcompacted", beforeSeq: 0 }] : [];
			},
		});
		expect(whys).toEqual(["request", "overflow"]);
		const terminal = events.find((e) => e.type === "terminal") as { outcome: { kind: string; error?: { code: string } } };
		expect(terminal.outcome.kind).toBe("error");
		expect(terminal.outcome.error?.code).toBe("context_overflow");
	});

	it("an overflow the compaction point cannot answer ends the run at once, without re-sending", async () => {
		const registry = new ToolRegistry();
		const log = new EventLog();
		log.append({ type: "user_input", content: "go" });
		let requests = 0;
		const adapter = createFauxProvider([overflowTurn, say("never")]);
		const counting = { stream: (opts: Parameters<typeof adapter.stream>[0]) => (requests++, adapter.stream(opts)) } as typeof adapter;
		const events = await drain({ adapter: counting, model: "faux", registry, log, compact: async () => [] });
		expect(requests).toBe(1);
		const terminal = events.find((e) => e.type === "terminal") as { outcome: { error?: { code: string } } };
		expect(terminal.outcome.error?.code).toBe("context_overflow");
	});

	it("without a compaction point an overflow ends the run as it always did", async () => {
		const registry = new ToolRegistry();
		const log = new EventLog();
		log.append({ type: "user_input", content: "go" });
		const events = await drain({ adapter: createFauxProvider([overflowTurn]), model: "faux", registry, log });
		const terminal = events.find((e) => e.type === "terminal") as { outcome: { error?: { code: string } } };
		expect(terminal.outcome.error?.code).toBe("context_overflow");
	});
});

describe("A1b — a 400 that says the context is too long is an overflow", () => {
	it.each([
		"This model's maximum context length is 1048576 tokens. However, you requested 1100000 tokens",
		"context_length_exceeded",
		"prompt is too long: 210000 tokens > 200000 maximum",
	])("%s", (message) => {
		expect(mapApiError(400, message).code).toBe("context_overflow");
	});

	it("any other 400 stays a malformed request", () => {
		expect(mapApiError(400, "invalid tool schema").code).toBe("invalid_request");
	});
});

describe("ADR-0055 Amendment 2 (decision 3) — the overflow is recognised by what it says, whatever the status", () => {
	// d4fc, verbatim: the op gateway streamed this with NO HTTP status, and
	// 0.40.1 classified it `unknown` — the overflow recovery never ran.
	const D4FC =
		"[deepseek] request failed: Streaming response failed: [400] This model's maximum context length is 1048576 tokens. However, you requested 131072 output tokens and your prompt contains at least 917505 input tokens, for a total of at least 1048577 tokens. Please reduce the length of the input prompt or the number of requested output tokens. (parameter=input_tokens, value=917505)";

	it("a streamed refusal with no status is context_overflow, not retryable", () => {
		const e = mapApiError(undefined, D4FC);
		expect(e.code).toBe("context_overflow");
		expect(e.retryable).toBe(false);
	});

	it("a 5xx that says the context is too long is context_overflow — its retries would re-send what cannot fit", () => {
		const e = mapApiError(500, "request failed: 500 This model's maximum context length is 1048576 tokens");
		expect(e.code).toBe("context_overflow");
		expect(e.retryable).toBe(false);
		expect(e.status).toBe(500);
	});

	it("a bare 5xx keeps its retries, and an unrelated status-less failure stays unknown", () => {
		expect(mapApiError(500, "[deepseek] request failed: 500 Internal server error")).toMatchObject({ code: "api_5xx", retryable: true });
		expect(mapApiError(undefined, "something odd").code).toBe("unknown");
	});
});
