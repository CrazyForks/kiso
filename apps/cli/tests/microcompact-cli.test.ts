/**
 * ADR-0055 Amendment 1, A4 — the DECLARED REVERSAL of the C area's "microcompact
 * ON by default at half the model window". The standing prune is gone:
 * repeated mid-history clearing breaks the prompt cache on every clear, and
 * pruning is now a primitive the in-run tiers use, never a trigger of its own.
 *
 * The same seeded session (7 read results, ~1,750 estimated tokens) is
 * resumed on a 3,000-token window. Half the window is 1,500, so the removed
 * trigger WOULD have written a `microcompacted` boundary here; the gate pins
 * that it does not, and that the run still completes. (The soft tier is
 * also 1,500 and is eligible, but this crash-shaped seed has no settled
 * round to cut at, so the tiers correctly do nothing.)
 */

import { execFileSync } from "node:child_process";
import { isolatedEnv } from "../../../tests/helpers/isolated-cli.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI = join(fileURLToPath(new URL("..", import.meta.url)), "dist", "index.js");

/** Seed the session JSONL exactly as the store writes it (runId + ts
 *  outside the event, contiguous seq inside). The session is an OPEN run —
 *  the crash shape — so `kiso resume` continues it. */
function seedSession(home: string, id: string): void {
	const dir = join(home, "sessions");
	mkdirSync(dir, { recursive: true });
	let seq = 0;
	const lines: string[] = [];
	const push = (event: Record<string, unknown>): void => {
		lines.push(JSON.stringify({ runId: "r1", ts: seq, event }));
		seq += 1;
	};
	push({ seq, type: "user_input", content: "start" });
	for (let i = 0; i < 7; i++) {
		push({ seq, type: "tool_call_end", callId: `r${i}`, name: "read_file", input: { path: `f${i}.ts` } });
		push({ seq, type: "tool_result", callId: `r${i}`, content: "line\n".repeat(200), isError: false });
		push({ seq, type: "user_input", content: `t${i}` });
	}
	writeFileSync(join(dir, `${id}.jsonl`), lines.join("\n") + "\n", "utf8");
}

describe("A4 cli: the standing microcompact at half the window is gone", () => {
	it("a resume over half the window records NO standing boundary, and completes", () => {
		const dir = mkdtempSync(join(tmpdir(), "kiso-mc-cli-"));
		const { env: isoEnv, dirs } = isolatedEnv();
		const home = dirs.home;
		seedSession(home, "k9");
		// fauxSkip (the durable script position) = 7 completed turns — the
		// script must cover them: 8 end_turn turns, the resume serves the
		// eighth.
		const script = Array.from({ length: 8 }, () => ({ events: [{ type: "stop", reason: "end_turn" }] }));
		const scriptPath = join(dir, "faux.json");
		writeFileSync(scriptPath, JSON.stringify(script), "utf8");

		// Window 3,000 tokens: half is 1,500, under the seeded ~1,750 — where
		// the removed trigger fired, before the first model turn.
		const out = execFileSync(process.execPath, [CLI, "resume", "k9"], {
			encoding: "utf8",
			timeout: 60_000,
			env: { ...isoEnv, KISO_FAUX_SCRIPT: scriptPath, KISO_CONTEXT_WINDOW: "3000" },
		});
		const durable = readFileSync(join(home, "sessions", "k9.jsonl"), "utf8");
		expect(durable).not.toContain('"type":"microcompacted"');
		expect(durable).toContain('"kind":"completed"');
		expect(out).toContain("✦"); // the recap line ends the resumed run
	}, 90_000);
});
