import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError, deleteCredential, endpointCredentialId, getCredential, maskSecret, modifyAuthFile, providerIdOf, readAuthFile, setCredential } from "../src/auth/credentials.js";
import { authForProfile, profileAvailable, unavailableReason, type ModelProfile } from "../src/config.js";

/** The credential store (the sign-in plan, step 1): the file, its mode, the
 *  one write path under a lock, and the resolve rule — a stored credential
 *  owns its provider. */
let dir: string;
let path: string;
let savedHome: string | undefined;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kiso-auth-"));
	path = join(dir, "home", "auth.json");
	savedHome = process.env.KISO_HOME;
	process.env.KISO_HOME = join(dir, "home");
	delete process.env.OPENAI_API_KEY;
	delete process.env.DEEPSEEK_KEY_FOR_TEST;
});
afterEach(() => {
	if (savedHome === undefined) delete process.env.KISO_HOME;
	else process.env.KISO_HOME = savedHome;
});

describe("the file", () => {
	it("is created on the first write with mode 0600, in a home created 0700, and reads back", () => {
		expect(readAuthFile(path)).toEqual({ version: 1, credentials: {} });
		setCredential("deepseek", { type: "api-key", key: "sk-test-1234", savedAt: 1 }, path);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(join(dir, "home")).mode & 0o777).toBe(0o700);
		expect(getCredential("deepseek", path)).toEqual({ type: "api-key", key: "sk-test-1234", savedAt: 1 });
		expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
	});
	it("a malformed or unknown-shaped file is named, never guessed at", () => {
		mkdirSync(join(dir, "home"), { recursive: true });
		writeFileSync(path, "{ nope", "utf8");
		expect(() => readAuthFile(path)).toThrow(AuthError);
		writeFileSync(path, JSON.stringify({ version: 2, credentials: {} }), "utf8");
		expect(() => readAuthFile(path)).toThrow(/unknown shape/);
	});
	it("delete reports whether anything was there; the file survives empty", () => {
		setCredential("openai", { type: "api-key", key: "k", savedAt: 1 }, path);
		expect(deleteCredential("openai", path)).toBe(true);
		expect(deleteCredential("openai", path)).toBe(false);
		expect(readAuthFile(path).credentials).toEqual({});
	});
});

describe("the one write path", () => {
	it("serializes writers across PROCESSES: twenty children each add their own provider; nothing is lost", () => {
		mkdirSync(join(dir, "home"), { recursive: true });
		const script = join(dir, "writer.mjs");
		writeFileSync(
			script,
			`import { setCredential } from ${JSON.stringify(new URL("../dist/auth/credentials.js", import.meta.url).href)};
const [id, p] = process.argv.slice(2);
setCredential(id, { type: "api-key", key: "k-" + id, savedAt: 1 }, p);`,
			"utf8",
		);
		const N = 20;
		const procs = Array.from({ length: N }, (_, i) => execFileSync(process.execPath, [script, `p${i}`, path], { encoding: "utf8" }));
		expect(procs).toHaveLength(N);
		const file = readAuthFile(path);
		expect(Object.keys(file.credentials).sort()).toEqual(Array.from({ length: N }, (_, i) => `p${i}`).sort());
	});
	it("a stale lock (an earlier process that died) is reclaimed by age", () => {
		mkdirSync(join(dir, "home"), { recursive: true });
		const lock = `${path}.lock`;
		mkdirSync(lock);
		const old = new Date(Date.now() - 60_000);
		execFileSync("touch", ["-t", `${old.getFullYear()}${String(old.getMonth() + 1).padStart(2, "0")}${String(old.getDate()).padStart(2, "0")}${String(old.getHours()).padStart(2, "0")}${String(old.getMinutes()).padStart(2, "0")}`, lock]);
		setCredential("zai", { type: "api-key", key: "k", savedAt: 1 }, path);
		expect(existsSync(lock)).toBe(false);
		expect(getCredential("zai", path)?.type).toBe("api-key");
	});
	it("modifyAuthFile writes exactly what the transform returns", () => {
		modifyAuthFile(() => ({ version: 1, credentials: { anthropic: { type: "oauth", access: "a", refresh: "r", expires: 5, savedAt: 1 } } }), path);
		expect(getCredential("anthropic", path)?.type).toBe("oauth");
	});
});

describe("the resolve rule", () => {
	const deepseek: ModelProfile = { kind: "openai-compat", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_KEY_FOR_TEST" };
	const local: ModelProfile = { kind: "openai-compat", baseUrl: "http://localhost:11434", model: "x" };
	const custom: ModelProfile = { kind: "openai-compat", baseUrl: "http://localhost:11434", model: "x", apiKeyEnv: "CUSTOM_KEY" };
	it("provider identity: anthropic; openai by default; a known origin; null for an unknown one", () => {
		expect(providerIdOf("anthropic")).toBe("anthropic");
		expect(providerIdOf("openai-compat")).toBe("openai");
		expect(providerIdOf("openai-compat", "https://api.deepseek.com/v1")).toBe("deepseek");
		expect(providerIdOf("openai-compat", "https://open.bigmodel.cn/api")).toBe("zai");
		expect(providerIdOf("openai-compat", "http://localhost:11434")).toBeNull();
		expect(providerIdOf("openai-compat", "not a url")).toBeNull();
	});
	// DECLARED SUPERSESSION (R1, 2026-09-10). This case asserted OR-1's
	// rule: "the Responses dialect is served by exactly two identities, so
	// it has no `custom` bucket — an unrecognized origin is still OpenAI's
	// API shape behind a proxy, and OpenAI's credential pays for it."
	//
	// The sentence is where it went wrong. The DIALECT is OpenAI's; the
	// CREDENTIAL is not. Who speaks the protocol and who should be paid to
	// answer are different questions, and only the second decides where a
	// secret may travel — an external review reproduced the stored key
	// reaching a localhost capture. An unrecognized origin now resolves to
	// null and the profile's own `apiKeyEnv` pays.
	//
	// The two recognized origins are unchanged, which is the half of OR-1
	// that was always right.
	it("provider identity: the Responses dialect is chatgpt at that origin, openai at OpenAI's, and null elsewhere", () => {
		expect(providerIdOf("openai-responses")).toBe("openai");
		expect(providerIdOf("openai-responses", "https://chatgpt.com/backend-api")).toBe("chatgpt");
		expect(providerIdOf("openai-responses", "https://api.openai.com/v1")).toBe("openai");
		expect(providerIdOf("openai-responses", "http://127.0.0.1:8080")).toBeNull();
		expect(providerIdOf("openai-responses", "not a url")).toBeNull();
	});
	it("OR-1: a stored OAuth sign-in is USABLE by the Responses kind — the same credential that is a refusal for a key-only kind", () => {
		const subscription: ModelProfile = { kind: "openai-responses", baseUrl: "https://chatgpt.com/backend-api", model: "gpt-5.5" };
		setCredential("chatgpt", { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 1e6, accountId: "acct", savedAt: 1 }, path);
		// 0.40.7: the shape also carries the access token's expiry (for the
		// /model row), so this pins the two fields that decide the route
		expect(authForProfile("sub", subscription)).toMatchObject({ type: "oauth", providerId: "chatgpt" });
		// …and it is AVAILABLE: the key-only resolver would have called a
		// working sign-in broken, which is the bug this shape prevents.
		expect(profileAvailable(subscription)).toBe(true);
		expect(unavailableReason("sub", subscription)).toBe("");
	});
	it("nothing stored: the env var applies; unset → unavailable, naming both login and the var", () => {
		expect(profileAvailable(deepseek)).toBe(false);
		expect(unavailableReason("ds", deepseek)).toContain("run `kiso login deepseek` or set the env var DEEPSEEK_KEY_FOR_TEST");
		process.env.DEEPSEEK_KEY_FOR_TEST = "from-env";
		expect(authForProfile("ds", deepseek)).toEqual({ type: "api-key", apiKey: "from-env", source: "env" });
	});
	it("a stored key owns the provider — it wins over the env var", () => {
		process.env.DEEPSEEK_KEY_FOR_TEST = "from-env";
		setCredential("deepseek", { type: "api-key", key: "from-store", savedAt: 1 }, path);
		expect(authForProfile("ds", deepseek)).toEqual({ type: "api-key", apiKey: "from-store", source: "store" });
	});
	it("a stored OAuth credential where the adapter needs a key is a NAMED error, never a silent fall back to env", () => {
		process.env.DEEPSEEK_KEY_FOR_TEST = "from-env";
		setCredential("deepseek", { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 1e6, savedAt: 1 }, path);
		expect(() => authForProfile("ds", deepseek)).toThrow(/signed in to deepseek with OAuth.*kiso logout deepseek/);
		expect(profileAvailable(deepseek)).toBe(false);
	});
	// OR-2 (2026-09-09): the subscription backend takes NO API key (its manifest
	// says authMethods: ["oauth"]), so a chatgpt profile with nothing stored is not
	// an unauthenticated endpoint — it is waiting for its sign-in. The keyless rule
	// used to hand it a placeholder key: the listing said "available", and the
	// adapter (an apiKey selects the first-party target) would have sent an
	// unauthenticated request to the wrong URL.
	it("OR-2: a chatgpt profile with nothing stored is UNAVAILABLE and names kiso login chatgpt — never a placeholder key", () => {
		const subscription: ModelProfile = { kind: "openai-responses", baseUrl: "https://chatgpt.com/backend-api", model: "gpt-5.5" };
		expect(profileAvailable(subscription)).toBe(false);
		expect(unavailableReason("sub", subscription)).toContain("run `kiso login chatgpt`");
		expect(() => authForProfile("sub", subscription)).toThrow(/not signed in/);
		// the first-party Responses profile keeps the key rule: env or store, else unavailable naming both
		const first: ModelProfile = { kind: "openai-responses", model: "gpt-5.5", apiKeyEnv: "OPENAI_KEY_FOR_TEST" };
		expect(unavailableReason("openai", first)).toContain("run `kiso login openai` or set the env var OPENAI_KEY_FOR_TEST");
	});
	// DECLARED RE-PIN (0.40.6). This asserted `not.toContain("kiso login")`:
	// a custom origin's only door was its env var, and naming a VENDOR login
	// there would store a key that never applies to it. The second half still
	// holds and is what is pinned now; the first changed on purpose — a
	// custom origin has its own login (`kiso login --endpoint`), keyed to it.
	it("a keyless profile is an unauthenticated endpoint; a custom origin never names a vendor's login", () => {
		expect(authForProfile("local", local)).toEqual({ type: "api-key", apiKey: "none", source: "none" });
		expect(unavailableReason("c", custom)).toContain("set the env var CUSTOM_KEY");
		expect(unavailableReason("c", custom)).not.toMatch(/kiso login (?!--endpoint http:\/\/localhost:11434`)/);
	});
	it("a secret is only ever rendered masked", () => {
		expect(maskSecret("sk-abcdefgh1234")).toBe("••••1234");
		expect(maskSecret("abc")).toBe("••••");
	});
});

/**
 * R1 — a stored FIRST-PARTY credential is used only for the vendor's own
 * origin.
 *
 * `providerIdOf` returned `anthropic` for every anthropic-kind profile
 * and `openai` for every non-ChatGPT Responses profile, whatever the
 * baseUrl said, and `authForProfile` takes the stored credential BEFORE
 * the profile's `apiKeyEnv`. So a profile pointing at a proxy, with an
 * explicit key named for that proxy, sent the VENDOR'S STORED KEY to the
 * proxy instead. The compat kind was already right: an unknown origin
 * resolves to null and the env var pays.
 *
 * The rule: a stored credential resolves only when the origin is the
 * vendor's own — unset (the vendor's default), or one of the recognized
 * origins. Any other origin authenticates with `apiKeyEnv` only, and a
 * keyless custom endpoint gets nothing stored.
 */
describe("R1 — a stored credential never leaves the vendor's own origin", () => {
	const KEY = "ENV_KEY_FOR_TEST";
	beforeEach(() => {
		process.env[KEY] = "env-key-value";
	});
	afterEach(() => {
		delete process.env[KEY];
	});

	it("anthropic at a CUSTOM origin resolves no stored identity", () => {
		expect(providerIdOf("anthropic", "https://proxy.example/v1")).toBeNull();
		expect(providerIdOf("anthropic", "http://localhost:8080")).toBeNull();
	});

	it("the Responses dialect at a CUSTOM origin resolves no stored identity", () => {
		expect(providerIdOf("openai-responses", "http://127.0.0.1:8080")).toBeNull();
		expect(providerIdOf("openai-responses", "https://proxy.example")).toBeNull();
	});

	it("the vendors' OWN origins are unchanged", () => {
		expect(providerIdOf("anthropic")).toBe("anthropic");
		expect(providerIdOf("anthropic", "https://api.anthropic.com")).toBe("anthropic");
		expect(providerIdOf("openai-responses")).toBe("openai");
		expect(providerIdOf("openai-responses", "https://api.openai.com/v1")).toBe("openai");
		expect(providerIdOf("openai-responses", "https://chatgpt.com/backend-api")).toBe("chatgpt");
		expect(providerIdOf("openai-compat", "https://api.deepseek.com/v1")).toBe("deepseek");
	});

	it("with a key STORED and a key in the ENV, a proxied profile authenticates with the ENV key", () => {
		// the wire consequence, at the resolver: this is the value that
		// would have gone to the custom endpoint.
		setCredential("anthropic", { type: "api-key", key: "STORED-VENDOR-KEY", savedAt: 1 }, path);
		setCredential("openai", { type: "api-key", key: "STORED-VENDOR-KEY", savedAt: 1 }, path);
		const proxiedAnthropic: ModelProfile = { kind: "anthropic", baseUrl: "https://proxy.example/v1", model: "m", apiKeyEnv: KEY };
		const proxiedResponses: ModelProfile = { kind: "openai-responses", baseUrl: "http://127.0.0.1:8080", model: "m", apiKeyEnv: KEY };
		const proxiedCompat: ModelProfile = { kind: "openai-compat", baseUrl: "http://localhost:11434", model: "m", apiKeyEnv: KEY };
		for (const [label, p] of [["anthropic", proxiedAnthropic], ["responses", proxiedResponses], ["compat", proxiedCompat]] as const) {
			expect(authForProfile(label, p), `${label}: the env key pays for a custom origin`).toEqual({ type: "api-key", apiKey: "env-key-value", source: "env" });
		}
	});

	it("a KEYLESS custom endpoint gets nothing stored", () => {
		setCredential("anthropic", { type: "api-key", key: "STORED-VENDOR-KEY", savedAt: 1 }, path);
		const keyless: ModelProfile = { kind: "anthropic", baseUrl: "http://localhost:8080", model: "m" };
		expect(authForProfile("keyless", keyless)).toEqual({ type: "api-key", apiKey: "none", source: "none" });
	});

	it("the vendor's own origin still prefers the stored key over the env", () => {
		setCredential("anthropic", { type: "api-key", key: "STORED-VENDOR-KEY", savedAt: 1 }, path);
		const first: ModelProfile = { kind: "anthropic", model: "m", apiKeyEnv: KEY };
		expect(authForProfile("first", first)).toEqual({ type: "api-key", apiKey: "STORED-VENDOR-KEY", source: "store" });
	});
});

/** 0.40.6 — a gateway's key, stored under `endpoint:<origin>` by
 *  `kiso login --endpoint <url>`, owns exactly that origin. */
describe("the endpoint rule (0.40.6)", () => {
	it("the store id is the ORIGIN: path, query and a default port are dropped; anything not http(s) is null", () => {
		expect(endpointCredentialId("https://gateway.example/zen/go/v1?x=1")).toBe("endpoint:https://gateway.example");
		expect(endpointCredentialId("https://gateway.example:443/v1")).toBe("endpoint:https://gateway.example");
		expect(endpointCredentialId("https://gateway.example:8443/v1")).toBe("endpoint:https://gateway.example:8443");
		expect(endpointCredentialId("http://127.0.0.1:4000")).toBe("endpoint:http://127.0.0.1:4000");
		expect(endpointCredentialId("HTTPS://Gateway.Example/v1")).toBe("endpoint:https://gateway.example");
		for (const bad of [undefined, "", "gateway.example", "ftp://gateway.example", "file:///etc/passwd", "not a url"]) expect(endpointCredentialId(bad), String(bad)).toBeNull();
	});
	const gw = (baseUrl: string, apiKeyEnv?: string, kind: ModelProfile["kind"] = "openai-compat"): ModelProfile => ({ kind, baseUrl, model: "m", ...(apiKeyEnv !== undefined ? { apiKeyEnv } : {}) });
	it("a key stored for the profile's origin is used, before the env var; a keyless profile takes it too", () => {
		setCredential("endpoint:https://gateway.example", { type: "api-key", key: "STORED-GW", savedAt: 1 }, path);
		process.env.GW_KEY_FOR_TEST = "FROM-ENV";
		try {
			expect(authForProfile("gw", gw("https://gateway.example/zen/v1", "GW_KEY_FOR_TEST"))).toEqual({ type: "api-key", apiKey: "STORED-GW", source: "store" });
			expect(authForProfile("gw", gw("https://gateway.example/v1"))).toEqual({ type: "api-key", apiKey: "STORED-GW", source: "store" });
			expect(authForProfile("gw", gw("https://gateway.example", "GW_KEY_FOR_TEST", "anthropic"))).toEqual({ type: "api-key", apiKey: "STORED-GW", source: "store" });
		} finally {
			delete process.env.GW_KEY_FOR_TEST;
		}
	});
	it("another origin never gets it — another port, another scheme, another host, a subdomain", () => {
		setCredential("endpoint:https://gateway.example", { type: "api-key", key: "STORED-GW", savedAt: 1 }, path);
		for (const other of ["https://gateway.example:8443/v1", "http://gateway.example/v1", "https://api.gateway.example/v1", "https://gateway.example.evil/v1", "http://127.0.0.1:4000"]) {
			expect(profileAvailable(gw(other, "GW_UNSET_FOR_TEST")), other).toBe(false);
			expect(authForProfile("gw", gw(other))).toEqual({ type: "api-key", apiKey: "none", source: "none" });
		}
	});
	it("a vendor's origin is the vendor's: an endpoint entry for it is never read", () => {
		setCredential("endpoint:https://api.deepseek.com", { type: "api-key", key: "SHOULD-NOT-BE-READ", savedAt: 1 }, path);
		expect(profileAvailable(gw("https://api.deepseek.com/v1", "DEEPSEEK_UNSET_FOR_TEST"))).toBe(false);
	});
	it("the unavailable reason names both doors for a gateway", () => {
		expect(unavailableReason("gw", gw("https://gateway.example/v1", "GW_UNSET_FOR_TEST"))).toContain("set the env var GW_UNSET_FOR_TEST, or run `kiso login --endpoint https://gateway.example`");
	});
});
