import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli } from "../../../tests/helpers/isolated-cli.mjs";

/**
 * 0.40.6 — `kiso login --endpoint <url>`: a gateway's key, stored for its
 * ORIGIN, sent there and nowhere else.
 *
 * The owner, 2026-09-23: gateway profiles showed `unavailable` under plain
 * `kiso`, because their key lived only in an env var a wrapper script
 * exported. The store now holds a gateway key under `endpoint:<origin>`.
 * The rule it must keep is R1's (a stored credential never leaves its own
 * origin), so the assertions are Astra F1's shape — two loopbacks on two
 * ports, which are two origins, and what each one RECEIVED:
 *
 * - a key stored for B never arrives at A (a different port is a
 *   different origin);
 * - a key stored for A arrives at A, before the profile's env var;
 * - after logout, A gets the env var again.
 *
 * No network: 127.0.0.1 on ephemeral ports. Each server answers 401 so the
 * run ends at its first request.
 */
const CLI = join(fileURLToPath(new URL("../..", import.meta.url)), "cli", "dist", "index.js");

interface Loopback {
	readonly url: string;
	readonly keys: string[];
	close(): Promise<void>;
}

async function loopback(): Promise<Loopback> {
	const keys: string[] = [];
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		keys.push(String(req.headers.authorization ?? req.headers["x-api-key"] ?? "(none)"));
		res.writeHead(401, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: { type: "authentication_error", message: "synthetic test error" } }));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as { port: number }).port;
	return {
		url: `http://127.0.0.1:${port}`,
		keys,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((r) => server.close(() => r()));
		},
	};
}

/** One -p run against the profile `gw`; resolves when the CLI exits. */
async function runOnce(env: NodeJS.ProcessEnv, cwd: string): Promise<string> {
	const child = spawn(process.execPath, [CLI, "--model", "gw", "-p", "hello"], { env, cwd, stdio: ["ignore", "ignore", "pipe"] });
	let err = "";
	child.stderr.on("data", (d: Buffer) => {
		err += d.toString();
	});
	const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
	await new Promise<void>((r) => child.on("exit", () => r()));
	clearTimeout(timer);
	await new Promise((r) => setTimeout(r, 250)); // the socket may still be draining
	return err;
}

describe("0.40.6 e2e: a gateway key stored for its origin reaches that origin only", () => {
	it("stored for B: A never sees it; stored for A: A gets it before the env var; logout: the env var again", async () => {
		const a = await loopback();
		const b = await loopback();
		try {
			const { dirs, env } = isolatedEnv({ GW_KEY: "DUMMY_FROM_ENV" });
			writeFileSync(
				join(dirs.home, "config.json"),
				JSON.stringify({ model: "gw", models: { gw: { kind: "openai-compat", model: "some-model", baseUrl: `${a.url}/v1`, apiKeyEnv: "GW_KEY" } } }),
			);

			// B's key, stored through the CLI with a path on the URL — the
			// store keys it by origin alone
			const loginB = runCli(["login", "--endpoint", `${b.url}/zen/go/v1`], env, { input: "DUMMY_STORED_FOR_B\n" });
			expect(loginB.status, loginB.stderr).toBe(0);
			expect(loginB.stdout).toContain(`stored an API key for ${b.url} (••••OR_B)`);
			expect(loginB.stdout + loginB.stderr, "never echoed").not.toContain("DUMMY_STORED_FOR_B");
			const file = join(dirs.home, "auth.json");
			expect(statSync(file).mode & 0o777).toBe(0o600);
			expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).credentials)).toEqual([`endpoint:${b.url}`]);

			await runOnce(env as NodeJS.ProcessEnv, dirs.home);
			expect(a.keys, "A got the env var, never B's stored key").toEqual(["Bearer DUMMY_FROM_ENV"]);
			expect(b.keys, "and B got nothing — no profile points at it").toEqual([]);

			// A's key: stored beats the env var, as a vendor key does
			a.keys.length = 0;
			expect(runCli(["login", "--endpoint", `${a.url}/v1`], env, { input: "DUMMY_STORED_FOR_A\n" }).status).toBe(0);
			await runOnce(env as NodeJS.ProcessEnv, dirs.home);
			expect(a.keys).toEqual(["Bearer DUMMY_STORED_FOR_A"]);

			// and with no env var at all the profile still runs — the point
			const { GW_KEY: _drop, ...noEnv } = env as Record<string, string>;
			a.keys.length = 0;
			await runOnce(noEnv as NodeJS.ProcessEnv, dirs.home);
			expect(a.keys, "plain `kiso`: no env var, the stored key").toEqual(["Bearer DUMMY_STORED_FOR_A"]);

			// auth lists both, masked
			const auth = runCli(["auth"], env);
			expect(auth.stdout).toContain(`endpoint:${a.url}`);
			expect(auth.stdout).toContain(`endpoint:${b.url}`);
			expect(auth.stdout).not.toContain("DUMMY_STORED");

			// logout: A falls back to the env var; without it, unavailable, and A sees nothing
			const out = runCli(["logout", "--endpoint", `${a.url}/anything`], env);
			expect(out.stdout).toContain(`removed the key for ${a.url}`);
			expect(runCli(["logout", "--endpoint", a.url], env).stdout).toContain(`nothing stored for ${a.url}`);
			a.keys.length = 0;
			await runOnce(env as NodeJS.ProcessEnv, dirs.home);
			expect(a.keys).toEqual(["Bearer DUMMY_FROM_ENV"]);
			a.keys.length = 0;
			const err = await runOnce(noEnv as NodeJS.ProcessEnv, dirs.home);
			expect(a.keys, "no credential: nothing is sent").toEqual([]);
			expect(err).toContain(`kiso login --endpoint ${a.url}`);
		} finally {
			await a.close();
			await b.close();
		}
	}, 180_000);
});

describe("0.40.6: kiso login --endpoint refuses what it cannot own", () => {
	it("a vendor's own origin names the vendor's login; a non-URL is a usage error", () => {
		const { env } = isolatedEnv();
		const vendor = runCli(["login", "--endpoint", "https://api.deepseek.com/v1"], env, { input: "k\n" });
		expect(vendor.status).not.toBe(0);
		expect(vendor.stderr + vendor.stdout).toContain("https://api.deepseek.com is deepseek's own endpoint — run `kiso login deepseek`");
		for (const bad of [[], ["gateway.example"], ["ftp://gateway.example"]]) {
			const r = runCli(["login", "--endpoint", ...bad], env, { input: "k\n" });
			expect(r.status, bad.join(" ")).not.toBe(0);
			expect(r.stderr + r.stdout).toContain("kiso login --endpoint <url> — an http(s) URL");
		}
		const empty = runCli(["login", "--endpoint", "https://gateway.example/v1"], env, { input: "\n" });
		expect(empty.status).not.toBe(0);
		expect(empty.stderr + empty.stdout).toContain("no key given");
	});
});
