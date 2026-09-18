/**
 * The adapter's side of the unresolved-host rule (core connectionFailure).
 * The unresolved case is INJECTED: a real lookup cannot be relied on —
 * behind a fake-ip proxy (198.18.0.0/15) every name resolves, and the
 * failure arrives as a closed socket instead. The refused case is a real
 * socket.
 */

import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { createOpenAICompatAdapter, createOpenAICompatProvider } from "../src/index.js";

const OPTS = { model: "rig-model", messages: [{ role: "user" as const, content: "go" }] };
const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND api.exmaple.com"), { code: "ENOTFOUND" });

async function first(adapter: ReturnType<typeof createOpenAICompatProvider>): Promise<unknown> {
	try {
		for await (const _ of adapter.stream(OPTS)) void _;
		return undefined;
	} catch (err) {
		return err;
	}
}

describe("a connection that never reached a server (openai-compat)", () => {
	it("an unresolved host name fails at once, not retryable, naming the baseUrl", async () => {
		const client = { chat: { completions: { create: async () => Promise.reject(new OpenAI.APIConnectionError({ cause: new TypeError("fetch failed", { cause: enotfound }) })) } } };
		const err = await first(createOpenAICompatAdapter(client as never));
		expect(err).toMatchObject({ code: "network", retryable: false });
		expect((err as { message: string }).message).toContain("check the baseUrl");
	});

	it("a refused connection (a real socket) is still retryable — a restarting gateway looks like this", async () => {
		expect(await first(createOpenAICompatProvider({ apiKey: "rig", baseUrl: "http://127.0.0.1:1/v1" }))).toMatchObject({ code: "network", retryable: true });
	}, 30_000);
});
