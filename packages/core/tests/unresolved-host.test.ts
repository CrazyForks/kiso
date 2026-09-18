/**
 * A host name that does not resolve fails at once (the lead's ruling on
 * the retry budget, 2026-09-18): ten retries on a curve reaching 32 s
 * would spend minutes confirming a mistyped baseUrl. A REFUSED or reset
 * connection keeps the full budget — that is what a restarting gateway
 * looks like. The error code stays `network`; the decision is `retryable`.
 */

import { describe, expect, it } from "vitest";
import { connectionFailure } from "../src/errors.js";

const withCause = (code: string, depth: number): Error => {
	let e: Error & { code?: string } = Object.assign(new Error(`getaddrinfo ${code} example.invalid`), { code });
	for (let i = 0; i < depth; i += 1) e = new Error("wrapped", { cause: e });
	return e;
};

describe("connectionFailure", () => {
	it("an unresolved name, anywhere on the cause chain, is NOT retried — and says to check the baseUrl", () => {
		for (const code of ["ENOTFOUND"]) {
			for (const depth of [0, 1, 3]) {
				const e = connectionFailure(withCause(code, depth), "[x] request failed: Connection error.");
				expect(e, `${code} at depth ${depth}`).toMatchObject({ code: "network", retryable: false });
				expect(e.message).toContain("check the baseUrl");
			}
		}
	});

	it("a refused or reset connection, or nothing recognisable, keeps the retry", () => {
		// EAI_AGAIN too: a TEMPORARY resolution failure is a DNS server's blip
		for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]) {
			expect(connectionFailure(withCause(code, 1), "m")).toEqual({ code: "network", retryable: true, message: "m" });
		}
		expect(connectionFailure(new Error("fetch failed"), "m")).toEqual({ code: "network", retryable: true, message: "m" });
		expect(connectionFailure("a string", "m")).toEqual({ code: "network", retryable: true, message: "m" });
	});

	it("a cause chain that loops ends — the walk is bounded", () => {
		const a = new Error("a") as Error & { cause?: unknown };
		const b = new Error("b", { cause: a });
		a.cause = b;
		expect(connectionFailure(a, "m").retryable).toBe(true);
	});
});
