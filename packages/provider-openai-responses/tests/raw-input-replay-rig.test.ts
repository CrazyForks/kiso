/**
 * 0.43.0 (#13) — the Responses adapter replays the model's own argument
 * text in `function_call.arguments`; without rawInput, the stringified
 * parsed input. RED on 0.42.x. The server only captures the body — the
 * request then fails and the run ends `error`, which is not the point.
 */

import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loop, ToolRegistry, type Event, type Message } from "@vincemakes/kiso-core";
import { createOpenAIResponsesProvider } from "../src/index.js";

let server: Server;
let port = 0;
let bodies: Record<string, unknown>[] = [];

beforeEach(async () => {
	bodies = [];
	server = createServer((req, res) => {
		let raw = "";
		req.on("data", (c: Buffer) => (raw += c.toString()));
		req.on("end", () => {
			bodies.push(JSON.parse(raw) as Record<string, unknown>);
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "captured" } }));
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as { port: number }).port;
});
afterEach(async () => {
	await new Promise<void>((r) => server.close(() => r()));
});

async function replay(history: Message[]): Promise<string> {
	const adapter = createOpenAIResponsesProvider({ apiKey: "rig", baseUrl: `http://127.0.0.1:${port}/v1` });
	const out: Event[] = [];
	for await (const ev of loop({ adapter, model: "gpt-x", registry: new ToolRegistry(), messages: history, maxRetries: 0 })) out.push(ev);
	const items = bodies[0]!["input"] as { type: string; arguments?: string }[];
	return items.find((i) => i.type === "function_call")!.arguments!;
}

describe("#13 rig — the Responses adapter replays the lexical arguments", () => {
	it("a block with rawInput is replayed as that text", async () => {
		expect(
			await replay([
				{ role: "user", content: "go" },
				{ role: "assistant", blocks: [{ type: "tool_use", callId: "c1", name: "probe", input: { x: 5 }, rawInput: '{ "x": 5.0 }' }] },
				{ role: "tool", callId: "c1", content: "ok", isError: false },
				{ role: "user", content: "and?" },
			] as Message[]),
		).toBe('{ "x": 5.0 }');
	});

	it("a block without rawInput falls back to the stringified parsed input", async () => {
		expect(
			await replay([
				{ role: "user", content: "go" },
				{ role: "assistant", blocks: [{ type: "tool_use", callId: "c1", name: "probe", input: { x: 5 } }] },
				{ role: "tool", callId: "c1", content: "ok", isError: false },
				{ role: "user", content: "and?" },
			] as Message[]),
		).toBe('{"x":5}');
	});
});
