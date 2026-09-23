/**
 * Profile headers — ON THE WIRE. A profile's headers travel from the
 * runtime's buildAdapter through each provider to the request itself; the
 * assertion is what a loopback server RECEIVED, not what an options object
 * holds. No network: 127.0.0.1 on an ephemeral port, answering every
 * request with a 400 so each adapter fails fast after sending.
 */
import { createServer, type IncomingHttpHeaders } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StreamOptions } from "@vincemakes/kiso-core";
import { buildAdapter } from "../src/agent.js";

let port = 0;
const received: { url: string; headers: IncomingHttpHeaders }[] = [];
const server = createServer((req, res) => {
	received.push({ url: req.url ?? "", headers: req.headers });
	req.resume();
	res.writeHead(400, { "content-type": "application/json" });
	res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "synthetic test refusal" } }));
});
beforeAll(async () => {
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	port = (server.address() as { port: number }).port;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((r) => server.close(() => r()));
});

type Kind = "anthropic" | "openai-compat" | "openai-responses";
const base = (kind: Kind) => (kind === "anthropic" ? `http://127.0.0.1:${port}` : `http://127.0.0.1:${port}/v1`);

/** One request through buildAdapter; returns the headers the server saw. */
async function send(kind: Kind, headers?: Record<string, string>): Promise<IncomingHttpHeaders> {
	const before = received.length;
	const adapter = await buildAdapter(kind, { apiKey: "k-test", baseUrl: base(kind), ...(headers !== undefined ? { headers } : {}) });
	try {
		for await (const _ of adapter.stream({ model: "m", messages: [{ role: "user", content: "hi" }] } as StreamOptions)) {
			// the 400 ends it
		}
	} catch {
		// expected: the synthetic refusal
	}
	expect(received.length, `${kind}: exactly one request reached the server`).toBe(before + 1);
	return received.at(-1)!.headers;
}

describe("a profile's headers reach the request, for every adapter", () => {
	for (const kind of ["openai-compat", "anthropic", "openai-responses"] as const) {
		it(`${kind}: the configured header arrives with its value, beside the adapter's own credential`, async () => {
			const h = await send(kind, { "x-gateway-session": "2026-09-23T07-00-00-abcd" });
			expect(h["x-gateway-session"]).toBe("2026-09-23T07-00-00-abcd");
			expect(h.authorization ?? h["x-api-key"], "the credential still comes from apiKey").toMatch(/k-test/);
		});

		it(`${kind}: none configured, none sent — the request carries no header it did not carry before`, async () => {
			const h = await send(kind);
			expect(h["x-gateway-session"]).toBeUndefined();
		});
	}

	it("openai-responses: a configured header never replaces the adapter's own credential (they are merged over it)", async () => {
		const h = await send("openai-responses", { authorization: "Bearer not-the-key" });
		expect(h.authorization).toBe("Bearer k-test");
	});
});
