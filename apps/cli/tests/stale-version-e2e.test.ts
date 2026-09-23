import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "../../../tests/helpers/isolated-cli.mjs";

/**
 * 0.40.5 — END TO END, the built CLI: kiso is "upgraded" underneath a live
 * session (the installed package.json it reads is rewritten between two
 * turns) and the session says so ONCE, and /status names both versions.
 * KISO_INSTALLED_PACKAGE_JSON points the reader at a scratch copy, so the
 * checkout's own package.json is never touched. Faux model; no network.
 */
const CLI_DIR = join(fileURLToPath(new URL("../..", import.meta.url)), "cli");
const RUNNING = (JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8")) as { version: string }).version;

const say = (text: string) => ({ events: [{ type: "text_delta", text }, { type: "stop", reason: "end_turn" }] });

describe("a session upgraded underneath says so, once", () => {
	it("no notice while they agree; one after the upgrade; none on the next turn; /status names both", async () => {
		const { dirs, env } = isolatedEnv({});
		const installed = join(dirs.home, "installed-package.json");
		writeFileSync(installed, JSON.stringify({ name: "@vincemakes/kiso-code", version: RUNNING }));
		const script = join(dirs.home, "faux.json");
		writeFileSync(script, JSON.stringify([say("reply one"), say("reply two"), say("reply three")]));
		const child = spawn(process.execPath, [join(CLI_DIR, "dist", "index.js"), "chat", "stale-e2e"], {
			env: { ...env, KISO_FAUX_SCRIPT: script, KISO_INSTALLED_PACKAGE_JSON: installed },
			cwd: dirs.home,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let out = "";
		child.stdout.on("data", (d: Buffer) => (out += d.toString()));
		child.stderr.on("data", (d: Buffer) => (out += d.toString()));
		const until = async (needle: string, from = 0): Promise<number> => {
			const deadline = Date.now() + 20_000;
			while (Date.now() < deadline) {
				const i = out.indexOf(needle, from);
				if (i >= 0) return i;
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error(`timed out waiting for ${JSON.stringify(needle)}; got:\n${out}`);
		};
		try {
			child.stdin.write("first\n");
			const t1 = await until("✦ took", await until("reply one"));
			// the upgrade, between turns
			writeFileSync(installed, JSON.stringify({ name: "@vincemakes/kiso-code", version: "9.9.9" }));
			child.stdin.write("second\n");
			const t2 = await until("✦ took", await until("reply two", t1));
			child.stdin.write("/status\n");
			const s = await until("version ", t2);
			child.stdin.write("third\n");
			await until("✦ took", await until("reply three", s));
			child.stdin.write("exit\n");
			await new Promise<void>((r) => child.on("exit", () => r()));
		} finally {
			child.kill("SIGKILL");
		}
		const notice = `✦ kiso 9.9.9 is installed — this session runs ${RUNNING}; exit and resume it (kiso resume stale-e2e) to use it`;
		expect(out.split(notice).length - 1, "said exactly once").toBe(1);
		expect(out.indexOf(notice), "not before the upgrade").toBeGreaterThan(out.indexOf("reply one"));
		expect(out).toContain(`version ${RUNNING} (running) · 9.9.9 installed — restart to use it`);
		expect(out, "nothing about versions before the upgrade").not.toMatch(new RegExp(`kiso ${RUNNING.replace(/\./g, "\\.")} is installed`));
	}, 60_000);
});
