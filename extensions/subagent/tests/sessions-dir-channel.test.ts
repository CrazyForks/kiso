/**
 * 0.40.0 — a delegated child writes its session beside its parent's.
 *
 * With one session folder per project, the parent's folder is decided by
 * the CLI from its cwd, and a child may run elsewhere (an implementer's
 * worktree). The CLI hands the folder over in the delegation config; the
 * extension passes it to the child as KISO_SESSIONS_DIR and reads the
 * child's log back from there. Real child processes, faux mode.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import createSubagentExtension from "../dist/kiso-subagent.mjs";

const CLI = join(fileURLToPath(new URL("../../../apps/cli", import.meta.url)), "dist", "index.js");
const ctx = { signal: new AbortController().signal, sessionId: "parent" };
const saved = { ...process.env };

afterEach(() => {
	for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
	Object.assign(process.env, saved);
});

describe("the delegation config carries the parent's session folder", () => {
	it("the child's log lands in the folder the parent was handed, and is read back from there", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kiso-subagent-dir-"));
		const home = join(dir, "home");
		const folder = join(home, "projects", "-some-project");
		mkdirSync(folder, { recursive: true });
		const script = join(dir, "faux.json");
		writeFileSync(script, JSON.stringify([{ events: [{ type: "text_delta", text: "child done" }, { type: "stop", reason: "end_turn" }] }]), "utf8");
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPENAI_API_KEY;
		delete process.env.KISO_SUBAGENT_DEPTH;
		delete process.env.KISO_SESSIONS_DIR;
		Object.assign(process.env, {
			KISO_SUBAGENT_BIN: CLI,
			KISO_HOME: home,
			KISO_FAUX_SCRIPT: script,
			KISO_DELEGATION_CONFIG_JSON: JSON.stringify({ checks: {}, profiles: [], sessionsDir: folder }),
		});
		const ext = await createSubagentExtension();
		const delegate = ext.tools!.find((t) => t.name === "delegate")!;
		const r = (await delegate.execute({ tasks: [{ role: "explorer", task: "look" }] }, ctx)) as { content: string; isError: boolean };
		expect(r.isError, String(r.content)).toBe(false);
		expect(String(r.content)).toContain("child done");
		const children = readdirSync(folder).filter((f) => f.startsWith("sub-parent-") && f.endsWith(".jsonl"));
		expect(children).toHaveLength(1);
		expect(existsSync(join(home, "sessions"))).toBe(false);
	}, 60_000);
});
