/**
 * E5 (the composition round) — the three gates the ruling demanded, red
 * before green:
 *
 *   1. THE DEFAULT COMPOSITION CARRIES NO TASK SURFACE — the rent-ledger
 *      side proof: every request of a default-composition session shows
 *      no `system:ext:task` / `tool:task_set` rent line and no task_set
 *      toolCall. (E5-F1/F2: the task extension paid its rent on 13
 *      consecutive real-provider sessions and was never called — the
 *      measured dead weight leaves the default.)
 *
 * (0.44.0: the task extension is retired; the opt-in path and the
 * plan-carrying resume gates left with it. This proof stays as a guard.)
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli, stripANSI } from "../../../tests/helpers/isolated-cli.mjs";


/** All request lines of a session's trace. */
function traceRequests(home: string, sid: string): any[] {
	const p = join(home, "sessions", "traces", `${sid}.jsonl`);
	expect(existsSync(p), `trace missing: ${p}`).toBe(true);
	return readFileSync(p, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l))
		.filter((r) => r.kind === "request");
}

/** The task-surfaced rent lines of a request (the E4/E5 arm proof shape). */
function taskRent(req: any): any[] {
	return (req.rent ?? []).filter(
		(l: any) => l.surface.startsWith("system:ext:task") || l.surface.startsWith("tool:task_set"),
	);
}

/** The durable session log lines (run envelope + event). */
function logLines(home: string, sid: string): any[] {
	const p = join(home, "sessions", `${sid}.jsonl`);
	expect(existsSync(p), `session log missing: ${p}`).toBe(true);
	return readFileSync(p, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

/** The seq of the FIRST task_set tool_result in the durable log — the
 *  plan's position in the event stream (the resumed run's read-back
 *  coverage is asserted against it). tool_result events carry callId,
 *  not name — the task_set call is found first. */
function planSeq(home: string, sid: string): number {
	const events = logLines(home, sid).map((l) => l.event);
	const call = events.find((e) => e.type === "tool_call_end" && e.name === "task_set");
	const ev = call && events.find((e) => e.type === "tool_result" && e.callId === call.callId);
	if (!ev) throw new Error("no task_set tool_result in the durable log");
	return ev.seq as number;
}

/** A faux script file for the provider; returns its path. */
function fauxScript(turns: any[]): string {
	const p = join(mkdtempSync(join(tmpdir(), "kiso-faux-")), "faux.json");
	writeFileSync(p, JSON.stringify(turns), "utf8");
	return p;
}

describe("E5 composition — the default carries no task surface (rent-ledger proof)", () => {
	it("a default-composition session pays no task rent and never calls task_set", () => {
		const { env } = isolatedEnv({
			KISO_FAUX_SCRIPT: fauxScript([{ events: [{ type: "stop", reason: "end_turn" }] }]),
		});
		const res = runCli(["--mode", "bypass", "e5-g1"], env, { input: "hello\nexit\n" });
		expect(res.status, res.stderr).toBe(0);
		const reqs = traceRequests(env.KISO_HOME as string, "e5-g1");
		expect(reqs.length).toBeGreaterThan(0);
		for (const r of reqs) {
			expect(taskRent(r), JSON.stringify(r.rent)).toEqual([]);
			expect(r.toolCalls).not.toContain("task_set");
		}
	});
});
