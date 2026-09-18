/**
 * The manual `/compact` summary gets the MEASURED output budget (0.39.2).
 *
 * A live gateway session failed `/compact` with `the summary turn ended
 * with max_tokens — not a complete turn`. The call carried a fixed 4,000
 * and no reasoning setting. Measured on the failing profile, a complete
 * checkpoint of the reported size took 18,837 output tokens — and a rule
 * that scaled the budget from the covered estimate (built first) failed
 * both its attempts on that data. The budget is now a generous flat cap,
 * because a cap is not a charge. The numbers live beside the constant.
 *
 * THE TEST THAT MATTERS RUNS ON AN UNREGISTERED MODEL. Turning thinking
 * off is registry-gated, and the failing profile was not registered (7 of
 * 73 on the machine it was found on resolve). A suite that exercised only
 * the registered path would pass on the day the owner's profile stayed
 * broken. The budget is the fix and it is proven where the registry is
 * silent; thinking-off is the optimisation, proven where it is not.
 *
 * And the AUTO policy's call stays byte-identical to before: its reserve
 * assumes the fixed budget, and moving that is A1b's.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Adapter, AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { MANUAL_SUMMARY_BUDGET, SUMMARY_MAX_OUTPUT } from "../src/summarize.js";

const VALID = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "e", "## Current work", "w", "## Next steps", "n"].join("\n");

const text = (t: string): AdapterEvent => ({ seq: 0, type: "text_delta", text: t }) as AdapterEvent;
const stop = (reason: string): AdapterEvent => ({ seq: 0, type: "stop", reason }) as AdapterEvent;

/** One scripted run per call, and a RECORD of what each call asked for —
 *  the request is the evidence, not the outcome alone. */
function recording(runs: readonly (readonly AdapterEvent[])[]): { adapter: Adapter; requests: StreamOptions[] } {
	const requests: StreamOptions[] = [];
	const adapter = {
		stream: async function* (options: StreamOptions) {
			requests.push(options);
			for (const ev of runs[Math.min(requests.length - 1, runs.length - 1)]!) yield ev;
		},
	} as unknown as Adapter;
	return { adapter, requests };
}

const TRUNCATED = [text("## Goal\nhalf a checkp"), stop("max_tokens")];
const COMPLETE = [text(VALID), stop("end_turn")];

async function longSession(model: string, adapter: Adapter) {
	const dir = mkdtempSync(join(tmpdir(), "kiso-sumbudget-"));
	const store = new SessionStore(dir);
	let seq = 0;
	for (let i = 0; i < 9; i++) {
		await store.append("s", "r1", { seq: seq++, type: "user_input", content: `turn ${i}` });
		await store.append("s", "r1", { seq: seq++, type: "tool_call_end", callId: `r${i}`, name: "read_file", input: { path: `f${i}.ts` } });
		await store.append("s", "r1", { seq: seq++, type: "tool_result", callId: `r${i}`, content: "export const x = 1;\n".repeat(500), isError: false });
	}
	await store.append("s", "r1", { seq: seq++, type: "user_input", content: "final" });
	await store.append("s", "r1", { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
	const agent = createAgent({ model, store, tools: [], adapter });
	return { session: await agent.session({ id: "s" }), store };
}

describe("the budget holds what was measured", () => {
	it("a complete checkpoint of the reported size needed 18,837 — the budget must hold it", () => {
		// Pinned so nobody lowers the budget below the evidence without new
		// evidence. The measurement is in the constant's own comment.
		expect(MANUAL_SUMMARY_BUDGET).toBeGreaterThanOrEqual(18_837);
	});
});

describe("an UNREGISTERED model — where the owner's failure was", () => {
	it("the manual call asks for the measured budget, and the summary lands", async () => {
		const { adapter, requests } = recording([COMPLETE]);
		const { session, store } = await longSession("some-unregistered-model", adapter);
		const result = await session.summarize({ manualBudget: true });
		expect(result!.summary).toBe(VALID);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.maxTokens).toBe(MANUAL_SUMMARY_BUDGET);
		expect(store.load("s").some((r) => r.event.type === "summarized")).toBe(true);
	});

	it("sends NO reasoning — a raw field to a model nobody vouches for can be a 400", async () => {
		const { adapter, requests } = recording([COMPLETE]);
		const { session } = await longSession("some-unregistered-model", adapter);
		await session.summarize({ manualBudget: true });
		expect(requests[0]!.reasoning).toBeUndefined();
	});

	it("a max_tokens stop is ONE call, fails naming the budget, and persists nothing", async () => {
		// Not retried: at the same budget a retry buys the same truncation,
		// and the whole measured budget was already asked for.
		const { adapter, requests } = recording([TRUNCATED, COMPLETE]);
		const { session, store } = await longSession("some-unregistered-model", adapter);
		await expect(session.summarize({ manualBudget: true })).rejects.toThrow(new RegExp(`${MANUAL_SUMMARY_BUDGET}-token output budget`));
		expect(requests).toHaveLength(1);
		expect(store.load("s").some((r) => r.event.type === "summarized")).toBe(false);
	});
});

describe("a REGISTERED model — the optimisation", () => {
	it("thinking goes OFF, as the native value the registry states", async () => {
		const { adapter, requests } = recording([COMPLETE]);
		const { session } = await longSession("deepseek-flash", adapter);
		await session.summarize({ manualBudget: true });
		expect(requests[0]!.reasoning).toEqual({ thinking: "disabled" });
	});
});

describe("the AUTO policy's call is byte-identical to before", () => {
	it("fixed budget, no reasoning", async () => {
		// The reserve the policy fires on assumes SUMMARY_MAX_OUTPUT. A larger
		// budget here without moving the reserve would let a fire leave less
		// room than it promised; moving the reserve moves every session's
		// trigger. That is A1b's, with its bench.
		const { adapter, requests } = recording([COMPLETE]);
		const { session } = await longSession("deepseek-flash", adapter);
		await session.summarize();
		expect(requests[0]!.maxTokens).toBe(SUMMARY_MAX_OUTPUT);
		expect(requests[0]!.reasoning).toBeUndefined();
	});
});
