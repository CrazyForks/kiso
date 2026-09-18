/**
 * The adapter's side of the unresolved-host rule (core connectionFailure).
 * The unresolved case is INJECTED: a real lookup cannot be relied on —
 * behind a fake-ip proxy (198.18.0.0/15) every name resolves, and the
 * failure arrives as a closed socket instead. The refused case is a real
 * socket.
 */

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createAnthropicAdapter, createAnthropicProvider } from "../src/index.js";

const OPTS = { model: "rig-model", messages: [{ role: "user" as const, content: "go" }] };
const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND api.exmaple.com"), { code: "ENOTFOUND" });

async function first(adapter: ReturnType<typeof createAnthropicProvider>): Promise<unknown> {
	try {
		for await (const _ of adapter.stream(OPTS)) void _;
		return undefined;
	} catch (err) {
		return err;
	}
}

describe("a connection that never reached a server (anthropic)", () => {
	it("an unresolved host name fails at once, not retryable, naming the baseUrl", async () => {
		const client = {
			messages: {
				stream: () => {
					throw new Anthropic.APIConnectionError({ cause: new TypeError("fetch failed", { cause: enotfound }) });
				},
			},
		};
		const err = await first(createAnthropicAdapter(client as never));
		expect(err).toMatchObject({ code: "network", retryable: false });
		expect((err as { message: string }).message).toContain("check the baseUrl");
	});

	it("a refused connection (a real socket) is still retryable — a restarting gateway looks like this", async () => {
		expect(await first(createAnthropicProvider({ apiKey: "rig", baseUrl: "http://127.0.0.1:1" }))).toMatchObject({ code: "network", retryable: true });
	}, 30_000);
});
