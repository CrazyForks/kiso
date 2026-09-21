/**
 * XP-1 — a changed binding is a LINE, never a dead REPL (the owner's
 * ruling of 2026-09-21).
 *
 * Two defects, one shape. The runtime refused to open a session whose
 * recorded binding the process no longer served (that refusal is gone —
 * the current configuration wins and is recorded), and the CLI's
 * `chatLoop` did not guard the OPEN at all: the refusal escaped the loop,
 * killed the process, and left the session that was open behind with no
 * log at all — `<id>.meta.json` plus a ledger of `header` + `run_end(-1)`,
 * announced once by the opening banner and then unopenable and empty.
 * Three of those were found on the owner's machine, seconds apart, each
 * one the corpse of a REPL that had tried to `/resume` an older session.
 *
 * The doors, and what each owes:
 *   an IN-SESSION switch that cannot open (`/resume <id>`, the picker)
 *     prints the message and switches NOTHING — the session you were in
 *     stays open, and a second attempt is possible (the survival proof);
 *   the ENTRY open (`kiso resume <id>`) still fails loudly with the
 *     message and a non-zero status — nothing is on screen to preserve;
 *   a REFUSED open writes nothing: the target's sidecar is untouched.
 *
 * Hermetic: the sessions are created through the CLI itself under a
 * scripted faux provider, and the `co` profile pointed at the
 * commandcode origin is never called (no turn is sent through it — the
 * legs only open and switch).
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli, stripANSI } from "../../../tests/helpers/isolated-cli.mjs";

/** One plain turn per scripted entry — enough for the `-p` creation legs. */
function fauxScript(): string {
	const f = join(mkdtempSync(join(tmpdir(), "kiso-xp1bc-faux-")), "faux.json");
	writeFileSync(f, JSON.stringify(Array.from({ length: 8 }, () => ({ events: [{ type: "text_delta", text: "ok" }, { type: "stop", reason: "end_turn" }] }))));
	return f;
}

/** The `co` profile: the endpoint the owner's wrapper serves. No request
 *  ever leaves this test — the legs open a session and switch. */
const CO_PROFILE = {
	models: {
		co: { kind: "openai-compat", model: "deepseek/deepseek-v4-flash", apiKeyEnv: "CO_KEY", baseUrl: "https://api.commandcode.ai/provider/v1" },
	},
};

function metaOf(home: string, id: string): { revision: number; providerId: string | null; modelId: string } {
	const raw = readFileSync(join(home, "sessions", `${id}.meta.json`), "utf8");
	const parsed = JSON.parse(raw) as { profile: { revision: number; modelId: string; provider: { providerId: string } | null } };
	return { revision: parsed.profile.revision, providerId: parsed.profile.provider?.providerId ?? null, modelId: parsed.profile.modelId };
}

describe("XP-1 — a changed binding resumes under the CURRENT configuration", () => {
	it("an in-session /resume of a differently-bound session SWITCHES (the current binding wins, recorded) and the REPL lives", () => {
		const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
		const withKey = { ...env, CO_KEY: "fake" };
		// `old`: a session recorded under the faux binding (provider null)
		expect(runCli(["-p", "hi", "old"], env, { timeout: 60_000 }).status).toBe(0);
		expect(metaOf(dirs.home, "old").providerId, "the record is unscoped").toBeNull();
		writeFileSync(join(dirs.home, "config.json"), `${JSON.stringify(CO_PROFILE)}\n`);

		// the switch: the recorded binding and the process's differ
		const run = runCli(["chat", "fresh", "--model", "co"], withKey, { input: "/resume old\n", timeout: 60_000 });
		const out = stripANSI(`${run.stdout}${run.stderr}`);
		expect(run.status, `the switch must not kill the REPL: ${out}`).toBe(0);
		expect(out, "the change is said, once, in the body").toContain("binding changed");
		expect(out).toContain("now on deepseek/deepseek-v4-flash");
		expect(out, "and the recorded binding is named").toMatch(/unscoped/);
		const after = metaOf(dirs.home, "old");
		expect(after.revision, "the change is durable history").toBe(2);
		expect(after.providerId, "what will answer the next request").toBe("custom");
	});

	it("a BLOCKED session is a line too: the refusal prints, the REPL survives it, and it writes NOTHING", () => {
		const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
		const withKey = { ...env, CO_KEY: "fake" };
		expect(runCli(["-p", "hi", "broken"], env, { timeout: 60_000 }).status).toBe(0);
		writeFileSync(join(dirs.home, "config.json"), `${JSON.stringify(CO_PROFILE)}\n`);
		// an unreadable sidecar: the one refusal left after the ruling
		const sidecar = join(dirs.home, "sessions", "broken.meta.json");
		const CORRUPT = "{ this is not json";
		writeFileSync(sidecar, CORRUPT);

		// the refusal, then one more line: the prompt that follows it is the
		// survival proof (pre-patch the process died at the first refusal and
		// nothing came after it), and the sidecar is byte-untouched
		const run = runCli(["chat", "second", "--model", "co"], withKey, { input: "/resume broken\n/help\n", timeout: 60_000 });
		const out = stripANSI(`${run.stdout}${run.stderr}`);
		expect(run.status, `an in-session refusal must not kill the REPL: ${out}`).toBe(0);
		const refusal = out.indexOf("is unreadable");
		expect(refusal, `the refusal is a line: ${out}`).toBeGreaterThan(-1);
		expect(out.lastIndexOf("you> "), `the REPL is still taking input: ${out}`).toBeGreaterThan(refusal);
		expect(readFileSync(sidecar, "utf8"), "a REFUSED open writes nothing").toBe(CORRUPT);
		expect(metaOf(dirs.home, "second").revision, "the session that stayed open is untouched").toBe(1);
	});

	it("the ENTRY open still fails loudly — nothing is on screen to preserve there", () => {
		const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
		expect(runCli(["-p", "hi", "broken"], env, { timeout: 60_000 }).status).toBe(0);
		writeFileSync(join(dirs.home, "sessions", "broken.meta.json"), "{ this is not json");
		const run = runCli(["resume", "broken"], env, { timeout: 60_000 });
		expect(run.status, "the entry's refusal is the entry's error").not.toBe(0);
		expect(stripANSI(`${run.stdout}${run.stderr}`)).toMatch(/is unreadable/);
	});

	it("--accept-drift is accepted and INERT — the flag parses, and nothing needs it", () => {
		const { env, dirs } = isolatedEnv({ KISO_FAUX_SCRIPT: fauxScript() });
		const withKey = { ...env, CO_KEY: "fake" };
		expect(runCli(["-p", "hi", "old"], env, { timeout: 60_000 }).status).toBe(0);
		writeFileSync(join(dirs.home, "config.json"), `${JSON.stringify(CO_PROFILE)}\n`);
		const run = runCli(["chat", "third", "--model", "co", "--accept-drift"], withKey, { input: "/resume old\n", timeout: 60_000 });
		const out = stripANSI(`${run.stdout}${run.stderr}`);
		expect(run.status, out).toBe(0);
		expect(out, "the flag is not an error, and it is not needed either").not.toContain("accept-drift (");
		expect(metaOf(dirs.home, "old").providerId, "the switch ran under the current binding").toBe("custom");
	});
});
