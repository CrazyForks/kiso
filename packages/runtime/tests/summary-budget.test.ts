/**
 * The manual `/compact` summary gets a budget scaled to what it covers
 * (0.39.2).
 *
 * A live gateway session failed `/compact` with `the summary turn ended
 * with max_tokens — not a complete turn`. The summary call carried a
 * FIXED 4,000-token output budget and no reasoning setting, so a model
 * whose thinking defaults on spent its allowance thinking, and a
 * structured checkpoint of a large range can outgrow 4,000 on its own.
 *
 * THE TEST THAT MATTERS RUNS ON AN UNREGISTERED MODEL. The obvious fix —
 * turn thinking off — only fires for a model the registry can vouch for,
 * and the failing profile was not one of them (7 of the 73 profiles on
 * the machine it was found on resolve). A suite that exercised only the
 * registered path would pass on the day the owner's profile stayed
 * broken. So the budget is the fix and it is proven where the registry
 * is silent; thinking-off is the optimisation, proven where it is not.
 *
 * And the AUTO policy's call must be byte-identical to before: its
 * reserve assumes the fixed budget, and moving that is A1b's.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Adapter, AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { SUMMARY_MAX_OUTPUT, SUMMARY_OUTPUT_CEILING, summaryOutputBudget } from "../src/summarize.js";

const VALID = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "e", "## Current work", "w", "## Next steps", "n"].join("\n");

const text = (t: string): AdapterEvent => ({ seq: 0, type: "text_delta", text: t }) as AdapterEvent;
const stop = (reason: string): AdapterEvent => ({ seq: 0, type: "stop", reason }) as AdapterEvent;

/** An adapter that plays one scripted run per call and RECORDS what each
 *  call asked for — the request is the evidence, not the outcome alone. */
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

/** Enough rounds that there is something to cover, and bulky enough that
 *  the covered estimate is well above the floor's break-even. */
async function longSession(model: string, adapter: Adapter) {
	const dir = mkdtempSync(join(tmpdir(), "kiso-sumbudget-"));
	const store = new SessionStore(dir);
	let seq = 0;
	for (let i = 0; i < 9; i++) {
		await store.append("s", "r1", { seq: seq++, type: "user_input", content: `turn ${i}` });
		await store.append("s", "r1", { seq: seq++, type: "tool_call_end", callId: `r${i}`, name: "read_file", input: { path: `f${i}.ts` } });
		await store.append("s", "r1", { seq: seq++, type: "tool_result", callId: `r${i}`, content: "export const x = 1;\n".repeat(2_000), isError: false });
	}
	await store.append("s", "r1", { seq: seq++, type: "user_input", content: "final" });
	await store.append("s", "r1", { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
	const agent = createAgent({ model, store, tools: [], adapter });
	return { session: await agent.session({ id: "s" }), store };
}

describe("the budget rule", () => {
	it("small ranges keep today's 4,000 — nothing that worked before moves", () => {
		expect(summaryOutputBudget(0)).toBe(SUMMARY_MAX_OUTPUT);
		expect(summaryOutputBudget(30_000)).toBe(SUMMARY_MAX_OUTPUT);
		expect(summaryOutputBudget(48_000)).toBe(SUMMARY_MAX_OUTPUT);
	});

	it("the reported case gets room: ~95k covered is roughly twice the old budget", () => {
		expect(summaryOutputBudget(95_100)).toBeGreaterThan(7_000);
	});

	it("a runaway is bounded", () => {
		expect(summaryOutputBudget(10_000_000)).toBe(SUMMARY_OUTPUT_CEILING);
	});
});

describe("an UNREGISTERED model — where the owner's failure was", () => {
	it("a max_tokens stop is retried ONCE at double the budget, and the summary lands", async () => {
		const { adapter, requests } = recording([TRUNCATED, COMPLETE]);
		const { session, store } = await longSession("some-unregistered-model", adapter);
		const result = await session.summarize({ scaledBudget: true });

		expect(result).not.toBeNull();
		expect(result!.summary).toBe(VALID);
		expect(requests).toHaveLength(2);
		const first = requests[0]!.maxTokens!;
		expect(first).toBeGreaterThan(SUMMARY_MAX_OUTPUT); // scaled, not the fixed 4,000
		expect(requests[1]!.maxTokens).toBe(Math.min(first * 2, SUMMARY_OUTPUT_CEILING));
		expect(store.load("s").some((r) => r.event.type === "summarized")).toBe(true);
	});

	it("sends NO reasoning — a raw field to a model nobody vouches for can be a 400", async () => {
		const { adapter, requests } = recording([COMPLETE]);
		const { session } = await longSession("some-unregistered-model", adapter);
		await session.summarize({ scaledBudget: true });
		expect(requests[0]!.reasoning).toBeUndefined();
	});

	it("two max_tokens stops end in a failure that NAMES the budget — and nothing is persisted", async () => {
		const { adapter, requests } = recording([TRUNCATED, TRUNCATED, COMPLETE]);
		const { session, store } = await longSession("some-unregistered-model", adapter);
		await expect(session.summarize({ scaledBudget: true })).rejects.toThrow(/output budget/);
		expect(requests).toHaveLength(2); // one retry, not a loop
		expect(store.load("s").some((r) => r.event.type === "summarized")).toBe(false);
	});
});

describe("a REGISTERED model — the optimisation", () => {
	it("thinking goes OFF, as the native value the registry states", async () => {
		const { adapter, requests } = recording([COMPLETE]);
		const { session } = await longSession("deepseek-flash", adapter);
		await session.summarize({ scaledBudget: true });
		expect(requests[0]!.reasoning).toEqual({ thinking: "disabled" });
	});
});

describe("the AUTO policy's call is byte-identical to before", () => {
	it("fixed budget, no reasoning, and a max_tokens stop is NOT retried", async () => {
		// The reserve the policy fires on assumes SUMMARY_MAX_OUTPUT. A
		// larger budget here without moving the reserve would let a fire
		// leave less room than it promised; moving the reserve moves every
		// session's trigger. That is A1b's, with its bench.
		const { adapter, requests } = recording([TRUNCATED, COMPLETE]);
		const { session } = await longSession("deepseek-flash", adapter);
		await expect(session.summarize()).rejects.toThrow(/max_tokens/);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.maxTokens).toBe(SUMMARY_MAX_OUTPUT);
		expect(requests[0]!.reasoning).toBeUndefined();
	});
});
