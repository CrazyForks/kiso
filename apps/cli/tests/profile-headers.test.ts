import { describe, expect, it } from "vitest";
import { adapterOptionsFor, expandProfileHeaders } from "../src/auth/adapter-options.js";
import { parseConfig, type ModelProfile } from "../src/config.js";

/**
 * Profile headers (the owner, 2026-09-23) — a model profile names the
 * headers its endpoint needs. The case: a gateway refuses any request
 * without its session header, so the owner's profiles pointed at a local
 * forwarder whose only job was to add one — and it added ONE id for every
 * kiso session. `{session}` makes the id the kiso session's own.
 */

const parse = (headers: unknown) =>
	parseConfig(JSON.stringify({ models: { gw: { kind: "openai-compat", model: "m", apiKeyEnv: "K", baseUrl: "https://gateway.example/v1", headers } } }), "test").models?.gw;

describe("the config: a profile's headers, parsed strictly", () => {
	it("names are lower-cased; `{session}` is kept for the adapter options to fill", () => {
		expect(parse({ "X-Gateway-Session": "{session}", "X-Client": "kiso" })?.headers).toEqual({ "x-gateway-session": "{session}", "x-client": "kiso" });
	});

	it("a credential or framing header is refused BY NAME — a key never lives in the config file", () => {
		for (const name of ["Authorization", "proxy-authorization", "X-Api-Key", "api-key", "Cookie", "host", "content-length", "Content-Type", "transfer-encoding", "connection"]) {
			expect(() => parse({ [name]: "v" }), name).toThrow(new RegExp(`headers\\.${name}.*apiKeyEnv or kiso login`));
		}
	});

	it("a bad name, a multi-line or non-string value, a case-insensitive duplicate and a non-object are refused with the field named", () => {
		expect(() => parse({ "x session": "v" })).toThrow(/headers\.x session/);
		expect(() => parse({ "x-a": "one\r\nx-b: two" })).toThrow(/headers\.x-a.*one-line/);
		expect(() => parse({ "x-a": 7 })).toThrow(/headers\.x-a.*one-line/);
		expect(() => parse({ "X-A": "1", "x-a": "2" })).toThrow(/named twice/);
		expect(() => parse(["x-a"])).toThrow(/headers — expected an object/);
		expect(() => parse("x-a: 1")).toThrow(/headers — expected an object/);
	});
});

const profile = (extra: Partial<ModelProfile> = {}): ModelProfile => ({ kind: "openai-compat", model: "m", apiKeyEnv: "K", baseUrl: "https://gateway.example/v1", ...extra });
const key = { type: "api-key" as const, apiKey: "k" };

describe("the adapter options: `{session}` becomes the session's id", () => {
	it("the session id fills the placeholder; a header without one passes as written", () => {
		const opts = adapterOptionsFor(profile({ headers: { "x-gateway-session": "{session}", "x-client": "kiso" } }), key, "2026-09-23T07-00-00-abcd");
		expect(opts.headers).toEqual({ "x-gateway-session": "2026-09-23T07-00-00-abcd", "x-client": "kiso" });
		expect(opts.promptCacheKey, "the same id as the cache key").toBe("2026-09-23T07-00-00-abcd");
	});

	it("no headers on the profile: the options are exactly today's — no `headers` key at all (the bench profile's path)", () => {
		const opts = adapterOptionsFor(profile(), key, "s1");
		expect("headers" in opts).toBe(false);
		expect(opts).toEqual({ apiKey: "k", baseUrl: "https://gateway.example/v1", promptCacheKey: "s1" });
	});

	it("no session (a listing that streams nothing): a header that needs one is left out, never sent with the placeholder", () => {
		expect(expandProfileHeaders({ "x-gateway-session": "{session}" }, undefined)).toBeUndefined();
		expect(expandProfileHeaders({ "x-gateway-session": "{session}", "x-client": "kiso" }, undefined)).toEqual({ "x-client": "kiso" });
		expect(expandProfileHeaders({ "x-trace": "kiso-{session}-{session}" }, "s1")).toEqual({ "x-trace": "kiso-s1-s1" });
		expect(expandProfileHeaders(undefined, "s1")).toBeUndefined();
	});
});
