#!/usr/bin/env node
/**
 * WHY A LEG STOPPED, decided from the evidence rather than from the fact
 * that the process exited.
 *
 * `run-ctx-ab.sh` called `mark_complete` unconditionally. A CLI can exit 0
 * having ended turns on a terminal ERROR — and one did: the third pair's
 * 500k leg took four `402 Insufficient Balance` refusals, so its last four
 * turns produced nothing, it wrote 124 of 147 entries and no final
 * deliverable, and it was recorded as a finished run that failed its task.
 * A vendor cutting us off is not the product failing, and scoring the two
 * together measures the harness. leg-limits.sh has said exactly this since
 * it was written; this runner imported the file and used none of it.
 *
 * IT READS FIELDS, NOT TEXT. The per-turn outcome is typed —
 * `terminal.outcome.kind`, and on an error `outcome.error.status` — so the
 * question "did the provider refuse us" has an exact answer. Matching the
 * string "402" against the event blob instead finds
 * `call_00_HQ8Y76310xZX3NQbF8VF6402`: a call id. On the screen it finds
 * line numbers in the source fixture, and it reported two hits on legs that
 * had no error at all.
 *
 * Note `stop` is the wrong event for this: a run's stop can be clean while
 * the TURN it belongs to ends in error. There are 38 stops and 8 terminals
 * in that leg, and the four errors are all in the terminals.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "../scripts/is-main.mjs";

/** Provider-side refusals: ours to retry later, never the product's fault. */
const PROVIDER_STATUS = (s) => s === 402 || s === 429 || (s >= 500 && s <= 599);

/**
 * A TRANSPORT failure is infrastructure too, and it carries no HTTP status.
 * The first version tested only the status code, so a leg that lost two
 * turns to `code: "network", message: "Connection error."` came back as
 * `error_terminal` — the class reserved for errors that ARE the product's.
 * Nothing about a dropped connection is the product's, and a comparison
 * that scores it as one is measuring the network.
 */
const INFRA_CODE = (c) => c === "network" || c === "timeout";

export function classify(work, { rc = 0, expectedTurns = null } = {}) {
	const dir = join(work, "kiso-home", "sessions");
	if (!existsSync(dir)) return { status: "startup_error", reason: "no session directory" };
	const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
	if (logs.length === 0) return { status: "startup_error", reason: "no session log" };

	const terminals = [];
	for (const f of logs) {
		for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
			if (line.trim() === "") continue;
			let rec;
			try { rec = JSON.parse(line); } catch { continue; }
			const e = rec.event ?? rec;
			if (e.type === "terminal") terminals.push(e.outcome ?? {});
		}
	}
	const errs = terminals.filter((o) => o.kind === "error");
	const provider = errs.filter((o) => PROVIDER_STATUS(Number(o.error?.status)));
	const transport = errs.filter((o) => INFRA_CODE(o.error?.code));
	const base = {
		turns: terminals.length,
		completedTurns: terminals.filter((o) => o.kind === "completed").length,
		errorTurns: errs.length,
		providerErrors: provider.map((o) => `${o.error?.status} ${o.error?.message ?? ""}`.trim()).slice(0, 4),
	};
	if (provider.length > 0) {
		return { ...base, status: "vendor_interrupted", reason: `${provider.length} provider refusal(s) ended turns` };
	}
	if (transport.length > 0) {
		return { ...base, status: "transport_failure", reason: `${transport.length} transport error(s) ended turns`,
			transportErrors: transport.map((o) => `${o.error?.code} ${o.error?.message ?? ""}`.trim()).slice(0, 4) };
	}
	if (rc === 142) return { ...base, status: "deadline", reason: "killed at the wall-clock cap" };
	if (errs.length > 0) return { ...base, status: "error_terminal", reason: `${errs.length} error terminal(s), none from the provider` };
	if (expectedTurns !== null && terminals.length < expectedTurns) {
		return { ...base, status: "truncated", reason: `${terminals.length} turns reached a terminal, ${expectedTurns} were sent` };
	}
	return { ...base, status: "completed", reason: "every turn reached a non-error terminal" };
}

if (isMain(import.meta.url)) {
	const [work, rcArg, turnsArg] = process.argv.slice(2);
	if (work === undefined) { console.error("usage: classify-leg.mjs <workdir> [rc] [expectedTurns]"); process.exit(2); }
	console.log(JSON.stringify(classify(work, {
		rc: Number.parseInt(rcArg ?? "0", 10),
		expectedTurns: turnsArg === undefined ? null : Number.parseInt(turnsArg, 10),
	}), null, 1));
}
