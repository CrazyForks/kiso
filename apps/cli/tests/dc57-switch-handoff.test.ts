/**
 * DC-57 — the line that arrives WITH a switch command goes to the session
 * that was asked for (the owner's ruling, 2026-09-21: option ① queue it).
 *
 * A switch is not applied at the moment it is requested: `/resume <id>` sets
 * a pending target and `chat()` returns; the loop opens the new session
 * afterwards. One read can carry several lines — a paste, a pipe, a
 * scripted driver — and the DEPARTING instance used to dispatch the rest of
 * the batch, so the turn landed in the session the person was leaving (and
 * spent that session's context: the measured probe was a prompt answered by
 * `fresh` while the switch to `alpha` happened afterwards).
 *
 * The fix is the mechanism the pre-ready lines already use: once the session
 * is leaving, further lines are queued and replayed by the NEXT `chat()`
 * entry. This gate asserts it on the durable logs — which session's
 * `user_input` the line became — never on the screen.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli, stripANSI } from "../../../tests/helpers/isolated-cli.mjs";

function fauxScript(): string {
	const f = join(mkdtempSync(join(tmpdir(), "kiso-dc57-faux-")), "faux.json");
	writeFileSync(f, JSON.stringify(Array.from({ length: 12 }, () => ({ events: [{ type: "text_delta", text: "ok" }, { type: "stop", reason: "end_turn" }] }))));
	return f;
}

/** Every `user_input` string in a session's durable log. */
function said(home: string, id: string): string[] {
	const log = join(home, "sessions", `${id}.jsonl`);
	const out: string[] = [];
	// A session nothing was ever said in has NO log at all — the switch left
	// it empty — so absence is the honest answer here, not an error.
	if (!existsSync(log)) return out;
	for (const line of readFileSync(log, "utf8").split("\n")) {
		if (!line.includes("user_input")) continue;
		try {
			const e = JSON.parse(line) as { event?: { type?: string; content?: string; text?: string } };
			if (e.event?.type !== "user_input") continue;
			out.push(String(e.event.content ?? e.event.text ?? ""));
		} catch {
			/* not this line */
		}
	}
	return out;
}

describe("DC-57 — a line that arrives with a switch belongs to the new session", () => {
	it("`/resume alpha` + a prompt in ONE read: the prompt is ALPHA's turn, not the departing session's", () => {
		const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
		expect(runCli(["-p", "hi", "alpha"], env, { timeout: 60_000 }).status).toBe(0);
		expect(runCli(["-p", "hi", "beta"], env, { timeout: 60_000 }).status).toBe(0);

		const run = runCli(["chat", "fresh"], env, { input: "/resume alpha\ntell me about widgets\n", timeout: 90_000 });
		const out = stripANSI(`${run.stdout}${run.stderr}`);
		expect(run.status, out).toBe(0);
		expect(out, "the switch itself still happens").toContain("session alpha (switched");
		expect(said(dirs.home, "alpha"), "the prompt is the NEW session's turn").toContain("tell me about widgets");
		expect(said(dirs.home, "fresh"), "and NEVER the departing session's").not.toContain("tell me about widgets");
	});

	it("a switch with nothing after it behaves exactly as before (the control)", () => {
		const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
		expect(runCli(["-p", "hi", "alpha"], env, { timeout: 60_000 }).status).toBe(0);
		const run = runCli(["chat", "fresh"], env, { input: "/resume alpha\n", timeout: 90_000 });
		const out = stripANSI(`${run.stdout}${run.stderr}`);
		expect(run.status, out).toBe(0);
		expect(out).toContain("session alpha (switched");
		expect(said(dirs.home, "alpha"), "no phantom turn was invented").toEqual(["hi"]);
	});
});
