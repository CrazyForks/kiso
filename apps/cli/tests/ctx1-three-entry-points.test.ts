import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedEnv, runCli } from "../../../tests/helpers/isolated-cli.mjs";
import { SessionStore } from "@vincemakes/kiso-runtime";

/**
 * CTX-1, finding F34-1 (Astra, 2026-09-14): ALL THREE entry points that open
 * a session must bind the policy that follows the session's own model.
 *
 * The first fix put those lines in the interactive loop only. `kiso resume
 * <id>` and `kiso -p <text> <id>` open through their own paths: they
 * restored the recorded model and kept the STARTUP threshold. A session
 * recorded on a 1M model, resumed from a 200k start, cleared its tool
 * results at 100,000 through two doors and at 500,000 through the third.
 *
 * THE GATE DRIVES THE REAL CLI, three times, on the same state. Testing the
 * setter proves the setter; it was never the setter that was wrong.
 *
 * A CONTROL RUNS TOO, and it is the reason the main assertion means
 * anything. The defect's signature is "no boundary was written", and a
 * boundary can be absent for many uninteresting reasons — the session did
 * not run, the history was too small, the faux adapter never took a turn.
 * So the control flips exactly one field, the recorded model id, to one the
 * registry does not know: at the 200k fallback the same history MUST
 * compact. Absence only counts as evidence when presence is also shown.
 */

const CLI = join(new URL("../..", import.meta.url).pathname, "cli", "dist", "index.js");
const SESSION = "s";
/** KISO_FAUX_SCRIPT names a FILE, not inline JSON. One turn, ending cleanly:
 *  the run has to reach its first turn for the boundary decision to happen at
 *  all, and nothing beyond that is under test here. */
function fauxScript(): string {
	const f = join(mkdtempSync(join(tmpdir(), "kiso-ctx1-faux-")), "faux.json");
	writeFileSync(f, JSON.stringify(Array.from({ length: 8 }, () => ({ events: [{ type: "stop", reason: "end_turn" }] }))));
	return f;
}

/** A history whose projected estimate lands between the two thresholds:
 *  well over 100,000, comfortably under 500,000.
 *
 *  Written through the STORE, not by appending lines. A hand-written record
 *  is rejected — `line 4 is not a session record` — because the durable
 *  format is more than the event, and a test that writes it by hand is
 *  testing its own guess at the format. */
async function seedHistory(home: string): Promise<void> {
	const store = new SessionStore(join(home, "sessions"));
	const existing = store.load(SESSION).map((r) => r.event);
	let seq = existing.reduce((m, e) => Math.max(m, (e as { seq: number }).seq), -1) + 1;
	const chunk = "line of a read file\n".repeat(600); // ~12,000 chars ≈ 3,000 tokens
	for (let i = 0; i < 50; i++) {
		await store.append(SESSION, "seed", { seq: seq++, type: "tool_call_end", callId: `c${i}`, name: "read_file", input: { path: `f${i}.ts` } } as never);
		await store.append(SESSION, "seed", { seq: seq++, type: "tool_result", callId: `c${i}`, content: chunk, isError: false } as never);
	}
	// RELEASE THE LOCK. Appending acquires this session's writer lock, and the
	// CLI we are about to drive is a DIFFERENT writer — it refuses with
	// `session s is locked by another writer`. Without this the session never
	// opens, no turn runs, no boundary is written, and the arm that expects
	// no boundary passes for a reason that has nothing to do with the fix.
	store.close(SESSION);
}

/** Rewrite ONLY the recorded model id. Everything the drift check looks at —
 *  the provider, the system prompt digest, the tool hashes — is left exactly
 *  as the CLI wrote it, so the session restores rather than being rebuilt. */
function recordModel(home: string, modelId: string): void {
	const dir = join(home, "sessions");
	const metaName = readdirSync(dir).find((f) => f.endsWith(".meta.json"));
	const path = join(dir, metaName!);
	const meta = JSON.parse(readFileSync(path, "utf8"));
	meta.profile.modelId = modelId;
	if (meta.profile.provider !== null && typeof meta.profile.provider === "object") meta.profile.provider.modelId = modelId;
	writeFileSync(path, `${JSON.stringify(meta, null, 1)}\n`);
}

function boundaries(home: string): number {
	const log = join(home, "sessions", `${SESSION}.jsonl`);
	return readFileSync(log, "utf8").split("\n").filter((l) => l.includes('"type":"microcompacted"')).length;
}

/** One door, from a clean isolated home: create, seed, record, reopen. */
async function openThrough(args: readonly string[], modelId: string): Promise<number> {
	const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
	runCli(["-p", "first", SESSION], env);
	await seedHistory(dirs.home);
	recordModel(dirs.home, modelId);
	runCli([...args], env);
	return boundaries(dirs.home);
}

describe("CTX-1 F34-1: every entry point binds the restored session's threshold", () => {
	const doors: readonly (readonly [string, readonly string[]])[] = [
		["kiso -p", ["-p", "continue", SESSION]],
		["kiso resume", ["resume", SESSION, "continue"]],
		["kiso chat", ["chat", SESSION]],
	];

	it.each(doors)("%s: the CONTROL compacts — an unknown model falls back to 200k, so 100k fires", async (_name, args) => {
		expect(await openThrough(args, "no-such-model-the-registry-knows")).toBeGreaterThanOrEqual(1);
	}, 60_000);

	it.each(doors)("%s: a session recorded on a 1M model does NOT compact at the startup threshold", async (_name, args) => {
		expect(await openThrough(args, "claude-sonnet-5")).toBe(0);
	}, 60_000);
});
