/**
 * CX-1 F9 — one execution config through every entry point.
 *
 * `kiso chat <id>` resolved autoCompact from the merged config;
 * the bare `kiso <id>` path passed `autoCompactFromEnv()` — env only —
 * so a user's config.json autoCompact worked on one documented entry
 * and silently vanished on the default one (audit F9, static trace).
 *
 * ADR-0055 Amendment 1 (the owner, 2026-09-18): `autoCompact` is RETIRED —
 * the in-run tiers replace the between-turn ratio. The equivalence the gate
 * exists for still holds, now for the retirement: the same config.json on
 * both entry points prints the same one-line notice, and neither runs the
 * old post-run compaction (five short turns are far below every tier).
 * KISO_AUTO_COMPACT is unset throughout (the config path is the subject).
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isolatedEnv, runCli } from "../../../tests/helpers/isolated-cli.mjs";

const SUMMARY =
	"## Goal\nfive rounds\n## Constraints\nnone\n## User requests\nfive hellos\n## Files and changes\nnone\n## Errors and fixes\nnone\n## Current work\nsummarized\n## Next steps\nkeep going";

function fixture(): { env: NodeJS.ProcessEnv; home: string } {
	const { env, dirs } = isolatedEnv();
	delete env.KISO_AUTO_COMPACT;
	// a threshold any single turn clears — the config path is the subject.
	// 0.40.0: 2 tokens of the 200k fallback window. The unbilled ratio is the
	// message estimate now, not chars/4 of the projection's JSON, so a
	// "hi"/"reply" turn is ~3 tokens rather than the ~20 its JSON punctuation read.
	writeFileSync(join(dirs.home, "config.json"), `${JSON.stringify({ autoCompact: { thresholdRatio: 0.00001 } })}\n`, "utf8");
	const dir = mkdtempSync(join(tmpdir(), "kiso-cx1-f9-"));
	const script = join(dir, "faux.json");
	const turns = Array.from({ length: 5 }, (_, i) => ({ events: [{ type: "text_delta", text: `reply ${i + 1}` }, { type: "stop", reason: "end_turn" }] }));
	turns.push({ events: [{ type: "text_delta", text: SUMMARY }, { type: "stop", reason: "end_turn" }] });
	writeFileSync(script, JSON.stringify(turns), "utf8");
	return { env: { ...env, KISO_FAUX_SCRIPT: script } as NodeJS.ProcessEnv, home: dirs.home };
}

const FIVE = "hi\nhi\nhi\nhi\nhi\nexit\n";

describe("CX-1 F9 — entry-point equivalence for the retired autoCompact", () => {
	for (const [name, args, id] of [
		["`kiso chat <id>`", ["chat", "f9-chat"], "f9-chat"],
		["bare `kiso <id>`", ["f9-bare"], "f9-bare"],
	] as const) {
		it(`${name}: config.json autoCompact prints the retirement notice once, and compacts nothing`, () => {
			const { env, home } = fixture();
			const res = runCli([...args], env, { input: FIVE, timeout: 60_000 });
			expect(res.status, res.stderr).toBe(0);
			expect(res.stderr.match(/\[autoCompact\] retired in 0\.40\.0/g) ?? []).toHaveLength(1);
			const log = readFileSync(join(home, "sessions", `${id}.jsonl`), "utf8");
			expect(log).not.toContain('"summarized"');
		});
	}
});
