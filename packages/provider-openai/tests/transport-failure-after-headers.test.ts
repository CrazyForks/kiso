/**
 * The transport-failure-after-headers class (0.39.1), openai-compat half.
 *
 * The rule and its controls are stated in full in the Responses adapter's
 * file of the same name. This half pins the two members that reach THIS
 * adapter: the body cut by the transport (COMPAT-F2, fixed in 0.33.0 and
 * pinned here because it now shares one helper with the rest of the
 * class), and the stream that ends with no `finish_reason` at all.
 *
 * The second one is the failure a long session actually dies of: a turn
 * streams for minutes, the upstream behind a gateway goes away, the
 * gateway ends a response it has already committed to a 200, and the run
 * used to terminate with `unknown: provider stopped with an error` — a
 * non-retryable verdict on a request nobody ever judged.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdapterEvent } from "@vincemakes/kiso-core";
import { createOpenAICompatProvider } from "../src/index.js";

type Reply = (res: ServerResponse) => void;

let server: Server;
let port = 0;
let reply: Reply;

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
	const body = { id: "c1", object: "chat.completion.chunk", created: 1, model: "rig-model", choices: [{ index: 0, delta, finish_reason: finish }] };
	return `data: ${JSON.stringify(body)}\n\n`;
}

/** The headers plus some real content — everything that makes the request
 *  ACCEPTED — before whatever the test does next. */
function openStream(res: ServerResponse): void {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	res.write(chunk({ role: "assistant", content: "half an answ" }));
}

beforeEach(async () => {
	reply = (res) => {
		openStream(res);
		res.write(chunk({}, "stop"));
		res.write("data: [DONE]\n\n");
		res.end();
	};
	server = createServer((req, res) => {
		req.resume();
		req.on("end", () => reply(res));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as { port: number }).port;
});
afterEach(async () => {
	await new Promise<void>((r) => server.close(() => r()));
});

async function collect(): Promise<AdapterEvent[]> {
	const adapter = createOpenAICompatProvider({ apiKey: "rig", baseUrl: `http://127.0.0.1:${port}/v1` });
	const out: AdapterEvent[] = [];
	for await (const ev of adapter.stream({ model: "rig-model", messages: [{ role: "user", content: "go" }] })) out.push(ev);
	return out;
}

describe("a failure AFTER the headers is retryable (openai-compat)", () => {
	it("0.40.7: an error FRAME inside the stream is a transport failure — retryable, not `unknown`", async () => {
		// the gateway's own words from finding-stream-error-frame-2026-09-17
		reply = (res) => {
			openStream(res);
			res.write(`data: ${JSON.stringify({ error: { message: "Upstream stream ended before terminal chunk" } })}\n\n`);
			res.end();
		};
		await expect(collect()).rejects.toMatchObject({ code: "network", retryable: true });
	});

	it("0.40.7: an error frame that SAYS the context is too long keeps that verdict — final, not retried", async () => {
		reply = (res) => {
			openStream(res);
			res.write(`data: ${JSON.stringify({ error: { message: "This model's maximum context length is 131072 tokens" } })}\n\n`);
			res.end();
		};
		await expect(collect()).rejects.toMatchObject({ code: "context_overflow", retryable: false });
	});

	it("a stream that ENDS with no finish_reason THROWS retryable rather than stopping the run", async () => {
		// `[DONE]` and a clean `end()`: the most innocent-looking close a
		// gateway can produce. The protocol still mandates a finish_reason,
		// so its absence is a failure in the path, not a verdict.
		reply = (res) => {
			openStream(res);
			res.write("data: [DONE]\n\n");
			res.end();
		};
		await expect(collect()).rejects.toMatchObject({ code: "network", retryable: true });
	});

	it("a stream cut mid-tool-call never emits the truncated call", async () => {
		// The kernel STARTS an execution on `tool_call_end`. A call whose
		// arguments were still arriving must not be closed out and launched
		// on a turn that is about to be abandoned: it would run a tool on a
		// half-arrived argument list, and a started call blocks the very
		// retry this throw exists to reach.
		reply = (res) => {
			openStream(res);
			res.write(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "shell", arguments: '{"cmd":"rm -rf ' } }] }));
			res.end();
		};
		const events: AdapterEvent[] = [];
		const adapter = createOpenAICompatProvider({ apiKey: "rig", baseUrl: `http://127.0.0.1:${port}/v1` });
		await expect(
			(async () => {
				for await (const ev of adapter.stream({ model: "rig-model", messages: [{ role: "user", content: "go" }] })) events.push(ev);
			})(),
		).rejects.toMatchObject({ code: "network", retryable: true });
		expect(events.some((e) => e.type === "tool_call_end")).toBe(false);
	});

	it("a body cut by the transport is retryable — COMPAT-F2, through the shared helper", async () => {
		reply = (res) => {
			openStream(res);
			setTimeout(() => res.destroy(), 10);
		};
		await expect(collect()).rejects.toMatchObject({ code: "network", retryable: true });
	});
});

describe("the controls — what this class does NOT reach", () => {
	it("a finish_reason this adapter does not recognize stays a non-retryable error STOP", async () => {
		// The provider stated a verdict. We do not know the word, but we
		// know it answered — there is nothing here to retry.
		reply = (res) => {
			openStream(res);
			res.write(chunk({}, "recitation"));
			res.write("data: [DONE]\n\n");
			res.end();
		};
		const events = await collect();
		expect(events[events.length - 1]).toMatchObject({ type: "stop", reason: "error" });
	});

	it("a non-2xx BEFORE the stream keeps its status mapping and stays non-retryable", async () => {
		reply = (res) => {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "bad input" } }));
		};
		await expect(collect()).rejects.toMatchObject({ status: 400, code: "invalid_request", retryable: false });
	});
});
