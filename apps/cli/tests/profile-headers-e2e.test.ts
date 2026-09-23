import { describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "../../../tests/helpers/isolated-cli.mjs";

/**
 * Profile headers — END TO END, the built CLI. A profile whose headers say
 * `{session}` sends the kiso session's OWN id: the value the loopback
 * receives is the id of the session file the run wrote, and a second run
 * is a second session with a second id. (The forwarder this replaces sent
 * one id for every session.) No network: 127.0.0.1, every request refused.
 */
const CLI = join(fileURLToPath(new URL("../..", import.meta.url)), "cli", "dist", "index.js");

function sessionIds(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string): void => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			if (e.isDirectory()) {
				if (e.name !== "traces") walk(join(d, e.name));
			} else if (e.name.endsWith(".jsonl")) out.push(e.name.slice(0, -".jsonl".length));
		}
	};
	walk(dir);
	return out.sort();
}

describe("a profile's `{session}` header carries the kiso session's own id", () => {
	it("each run sends its own session's id — two runs, two sessions, two ids", async () => {
		const seen: string[] = [];
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const v = req.headers["x-gateway-session"];
			if (typeof v === "string") seen.push(v);
			req.resume();
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { type: "invalid_request_error", message: "synthetic test refusal" } }));
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const port = (server.address() as { port: number }).port;
		try {
			const { dirs, env } = isolatedEnv({ GATEWAY_TEST_KEY: "k-test" });
			writeFileSync(
				join(dirs.home, "config.json"),
				JSON.stringify({
					model: "gw",
					models: { gw: { kind: "openai-compat", model: "some-model", apiKeyEnv: "GATEWAY_TEST_KEY", baseUrl: `http://127.0.0.1:${port}/v1`, headers: { "X-Gateway-Session": "{session}" } } },
				}),
			);
			for (let i = 0; i < 2; i++) {
				const child = spawn(process.execPath, [CLI, "--model", "gw", "-p", "hello"], { env, cwd: dirs.home, stdio: "ignore" });
				const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
				await new Promise<void>((r) => child.on("exit", () => r()));
				clearTimeout(timer);
			}
			await new Promise((r) => setTimeout(r, 250));
			const ids = sessionIds(join(dirs.home, "sessions"));
			expect(ids, "two runs wrote two sessions").toHaveLength(2);
			expect(new Set(seen).size, "two distinct ids reached the server").toBe(2);
			expect([...new Set(seen)].sort(), "each is the id of a session the run wrote").toEqual(ids);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((r) => server.close(() => r()));
		}
	}, 60_000);
});
