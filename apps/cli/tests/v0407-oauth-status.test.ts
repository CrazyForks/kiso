import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli } from "../../../tests/helpers/isolated-cli.mjs";

/**
 * 0.40.7 — /model says what a subscription sign-in can still do.
 *
 * The owner, 2026-09-23, reading `kiso auth` ("chatgpt oauth … expires
 * 2026-09-19 (expired)") while `/model` called both ChatGPT profiles
 * `oauth (available)`: should an expired token leave the list? Not
 * removed — the profile is the human's config, and a row that vanished
 * would not say how to get it back — but told plainly:
 *  - an access token past its expiry renews on the next use, so the row
 *    stays available and says `oauth, expired — renews on use`;
 *  - a sign-in whose renewal the endpoint REFUSED is over: the row is
 *    `(unavailable)` and the reason names `kiso login chatgpt`.
 *
 * The built CLI on a pipe, an isolated home, no network.
 */
// the default is a keyless local profile, so the session starts and /model
// lists `sub` whatever state its sign-in is in
const profiles = (model = "local") => ({
	model,
	models: {
		local: { kind: "openai-compat", model: "m", baseUrl: "http://127.0.0.1:1/v1" },
		sub: { kind: "openai-responses", model: "gpt-5.5", baseUrl: "https://chatgpt.com/backend-api" },
	},
});
const oauth = (extra: Record<string, unknown>) => ({
	version: 1,
	credentials: { chatgpt: { type: "oauth", access: "DUMMY_ACCESS", refresh: "DUMMY_REFRESH", expires: Date.parse("2026-09-19T07:35:10Z"), accountId: "acct", savedAt: 1, ...extra } },
});

function listAndAuth(extra: Record<string, unknown>, model?: string): { row: string; out: string; auth: string } {
	const { dirs, env } = isolatedEnv();
	writeFileSync(join(dirs.home, "config.json"), JSON.stringify(profiles(model)));
	writeFileSync(join(dirs.home, "auth.json"), JSON.stringify(oauth(extra)), { mode: 0o600 });
	const out = runCli(["chat", "oauth-rows"], env, { input: "/model\nexit\n" });
	const all = out.stdout + out.stderr;
	const row = all.split("\n").find((l) => l.startsWith("  sub → ")) ?? "";
	return { row, out: all, auth: runCli(["auth"], env).stdout };
}

describe("0.40.7: a subscription sign-in's state, on the /model row and in kiso auth", () => {
	it("expired access token: available, and the row says it renews on use", () => {
		const { row, auth, out } = listAndAuth({});
		expect(row, out).toContain("· oauth, expired — renews on use (available)");
		expect(auth).toContain("(expired — renews on use)");
		expect(out + auth).not.toMatch(/DUMMY_/);
	});
	it("renewal refused: unavailable, and the way back is named", () => {
		const { row, auth, out } = listAndAuth({ refreshRejectedAt: Date.parse("2026-09-20T00:00:00Z") });
		expect(row, out).toContain("(unavailable)");
		expect(auth).toContain("(renewal refused — run kiso login chatgpt)");
		expect(out + auth).not.toMatch(/DUMMY_/);
	});
	it("renewal refused on the DEFAULT profile: kiso says so at start, naming the way back", () => {
		const { out } = listAndAuth({ refreshRejectedAt: Date.parse("2026-09-20T00:00:00Z") }, "sub");
		expect(out).toContain("model sub: unavailable — the chatgpt sign-in was refused when kiso tried to renew it: run `kiso login chatgpt`");
		expect(out).not.toMatch(/DUMMY_/);
	});
});
