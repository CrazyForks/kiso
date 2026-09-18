/**
 * 0.40.0 — the summary call reports its progress against its OUTPUT
 * budget, counting reasoning as well as text (owner's ruling: a bar over
 * text alone sits low while thinking spends the budget, then the call
 * fails at "full").
 *
 * Streamed text and streamed reasoning are counted as they arrive (the
 * session's chars/4 proxy); the provider's reported output total replaces
 * the estimate when it lands. Reasoning a provider bills but never streams
 * is visible only in that total — the progress says so rather than letting
 * the bar jump without explanation.
 */
import { describe, expect, it } from "vitest";
import type { Adapter, StreamOptions } from "@vincemakes/kiso-core";
import { summarizeConversation, type SummaryProgress } from "../src/summarize.js";

const VALID = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "e", "## Current work", "w", "## Next steps", "n"].join("\n");

/** A scripted adapter that remembers the options of every stream call. */
function scripted(events: readonly object[]): { adapter: Adapter; seen: StreamOptions[] } {
	const seen: StreamOptions[] = [];
	const adapter: Adapter = {
		async *stream(options) {
			seen.push(options);
			for (const ev of events) yield { seq: 0, ...ev } as never;
		},
	};
	return { adapter, seen };
}

const usage = (outputTokens: number, reasoningTokens?: number) => ({
	type: "usage",
	known: true,
	inputTokens: 100,
	outputTokens,
	cacheRead: 0,
	cacheWrite: null,
	...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
});

describe("0.40.0 — summary progress", () => {
	it("counts streamed reasoning AND text, monotone, then the reported total", async () => {
		const { adapter } = scripted([
			{ type: "thinking", text: "x".repeat(400) },
			{ type: "thinking", text: "x".repeat(400) },
			{ type: "text_delta", text: VALID },
			{ type: "stop", reason: "end_turn" },
			usage(900, 200),
		]);
		const seen: SummaryProgress[] = [];
		await summarizeConversation({ adapter, model: "m", messages: [{ role: "user", content: "c" }], maxOutputTokens: 32_000, onProgress: (p) => seen.push(p) });
		// the first report is the attempt's zero
		expect(seen[0]).toEqual({ produced: 0, budget: 32_000, reasoningUnseen: false, reported: false });
		// reasoning moves the bar before any text arrives
		expect(seen[1]!.produced).toBe(100);
		expect(seen[2]!.produced).toBe(200);
		// monotone while estimating
		const estimates = seen.filter((p) => !p.reported).map((p) => p.produced);
		expect([...estimates].sort((a, b) => a - b)).toEqual(estimates);
		// the provider's total replaces the estimate
		expect(seen.at(-1)).toEqual({ produced: 900, budget: 32_000, reasoningUnseen: false, reported: true });
	});

	it("reasoning billed but never streamed is named, not hidden in a jump", async () => {
		const { adapter } = scripted([{ type: "text_delta", text: VALID }, { type: "stop", reason: "end_turn" }, usage(5_000, 4_800)]);
		const seen: SummaryProgress[] = [];
		await summarizeConversation({ adapter, model: "m", messages: [{ role: "user", content: "c" }], maxOutputTokens: 32_000, onProgress: (p) => seen.push(p) });
		expect(seen.at(-1)).toEqual({ produced: 5_000, budget: 32_000, reasoningUnseen: true, reported: true });
	});

	it("no budget on the call: progress still reports, with a null budget", async () => {
		const { adapter } = scripted([{ type: "text_delta", text: VALID }, { type: "stop", reason: "end_turn" }]);
		const seen: SummaryProgress[] = [];
		await summarizeConversation({ adapter, model: "m", messages: [{ role: "user", content: "c" }], onProgress: (p) => seen.push(p) });
		expect(seen.length, "no progress was reported at all").toBeGreaterThan(0);
		expect(seen.every((p) => p.budget === null)).toBe(true);
	});

	it("observation only: the request is byte-identical with or without onProgress, and a throwing observer changes nothing", async () => {
		const events = [{ type: "text_delta", text: VALID }, { type: "stop", reason: "end_turn" }];
		const a = scripted(events);
		const b = scripted(events);
		const base = { model: "m", messages: [{ role: "user" as const, content: "c" }], maxOutputTokens: 32_000 };
		const r1 = await summarizeConversation({ ...base, adapter: a.adapter });
		const r2 = await summarizeConversation({
			...base,
			adapter: b.adapter,
			onProgress: () => {
				throw new Error("a broken observer");
			},
		});
		expect(JSON.stringify(b.seen)).toBe(JSON.stringify(a.seen));
		expect(r2.text).toBe(r1.text);
	});
});
