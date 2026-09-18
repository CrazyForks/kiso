/**
 * The adapter's side of the unresolved-host rule (core connectionFailure).
 * The unresolved case is INJECTED (a stubbed fetch): a real lookup cannot
 * be relied on — behind a fake-ip proxy (198.18.0.0/15) every name
 * resolves, and the failure arrives as a closed socket instead. The
 * refused case is a real socket.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIResponsesProvider } from "../src/index.js";

const OPTS = { model: "rig-model", messages: [{ role: "user" as const, content: "go" }] };
const enotfound = Object.assign(new Error("getaddrinfo ENOTFOUND api.exmaple.com"), { code: "ENOTFOUND" });

async function first(baseUrl: string): Promise<unknown> {
	try {
		for await (const _ of createOpenAIResponsesProvider({ apiKey: "rig", baseUrl }).stream(OPTS)) void _;
		return undefined;
	} catch (err) {
		return err;
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("a connection that never reached a server (openai-responses)", () => {
	it("an unresolved host name fails at once, not retryable, naming the baseUrl", async () => {
		vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("fetch failed", { cause: enotfound })));
		const err = await first("http://api.exmaple.com/v1");
		expect(err).toMatchObject({ code: "network", retryable: false });
		expect((err as { message: string }).message).toContain("check the baseUrl");
	});

	it("a refused connection (a real socket) is still retryable — a restarting gateway looks like this", async () => {
		expect(await first("http://127.0.0.1:1/v1")).toMatchObject({ code: "network", retryable: true });
	}, 30_000);
});
