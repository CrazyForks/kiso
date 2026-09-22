/**
 * ADR-0055 Amendment 2 — the replay gate, CI half: the STACKED shape that
 * 0.40.1 wrote (every in-band checkpoint restating the whole task while
 * the projection kept every earlier one beside it) recovers by projection
 * alone. The owner's four real logs cannot enter the repo; this fixture is
 * their shape, and the local script `scripts/replay-projection.mjs`
 * measures the real logs (sizes and seqs only).
 */

import { describe, expect, it } from "vitest";
import type { Event, EventInput } from "../src/index.js";
import { projectMessages, SUMMARY_FRAMING } from "../src/kernel/project.js";
import type { Message } from "../src/protocol/messages.js";

const ev = (seq: number, e: EventInput): Event => ({ seq, ...e } as Event);

const chars = (m: Message): number => JSON.stringify(m).length;
const estimate = (msgs: readonly Message[]): number => msgs.reduce((n, m) => n + Math.ceil(chars(m) / 4), 0);
const isSummary = (m: Message): boolean => m.role === "user" && typeof m.content === "string" && m.content.startsWith(SUMMARY_FRAMING);

/**
 * N rounds of (input, read, 4 KB result, answer). After every round past
 * the first, a checkpoint lands covering everything but the last round —
 * the tail — and, like the in-band model, RESTATES the previous checkpoint
 * plus a delta, so each one is larger than the last (d7aa: 17,183 →
 * 73,449 chars).
 */
function stackedLog(rounds: number): { events: Event[]; summaries: string[] } {
	const events: Event[] = [];
	const summaries: string[] = [];
	let seq = 0;
	let previous = "## Goal\nthe task";
	for (let r = 0; r < rounds; r++) {
		events.push(ev(seq++, { type: "user_input", content: `round ${r}` }));
		events.push(ev(seq++, { type: "tool_call_end", callId: `c${r}`, name: "read_file", input: { path: `f${r}.ts` } }));
		events.push(ev(seq++, { type: "tool_result", callId: `c${r}`, content: "x".repeat(4000), isError: false }));
		events.push(ev(seq++, { type: "text_delta", text: `answer ${r}` }));
		events.push(ev(seq++, { type: "text_end" }));
		const lastOfPrevious = seq - 6; // the event before this round's input
		if (r > 0) {
			const summary = `${previous}\n- round ${r - 1}: read f${r - 1}.ts, ${"d".repeat(900)}`;
			events.push(ev(seq++, { type: "summarized", coversToSeq: lastOfPrevious, summary }));
			summaries.push(summary);
			previous = summary;
		}
	}
	return { events, summaries };
}

describe("ADR-0055 A2 — the stacked shape recovers by projection alone", () => {
	it("twelve stacked checkpoints project as ONE summary plus the raw tail", () => {
		const { events, summaries } = stackedLog(13);
		expect(summaries).toHaveLength(12);
		const msgs = projectMessages(events);
		// One summary message, and it is the latest checkpoint.
		const summaryMsgs = msgs.filter(isSummary);
		expect(summaryMsgs).toHaveLength(1);
		expect(String((summaryMsgs[0] as { content: unknown }).content).endsWith(summaries.at(-1)!)).toBe(true);
		expect(msgs[0]).toBe(summaryMsgs[0]);
		// The raw tail is the last round only: its input, call, result, answer.
		const users = msgs.filter((m) => m.role === "user" && !isSummary(m)).map((m) => (m as { content: unknown }).content);
		expect(users).toEqual(["round 12"]);
		// Bounded by (latest summary + tail + framing): the earlier summaries
		// contribute nothing.
		const tail = msgs.filter((m) => !isSummary(m));
		const bound = Math.ceil((SUMMARY_FRAMING.length + summaries.at(-1)!.length) / 4) + 16 + estimate(tail);
		expect(estimate(msgs)).toBeLessThanOrEqual(bound);
	});

	it("the projection after each checkpoint is bounded by that checkpoint plus one round — never by their sum", () => {
		const { events } = stackedLog(13);
		const at = events.flatMap((e, i) => (e.type === "summarized" ? [i] : []));
		for (const i of at) {
			const prefix = events.slice(0, i + 1);
			const latest = prefix[i] as Event & { type: "summarized" };
			const msgs = projectMessages(prefix);
			expect(msgs.filter(isSummary)).toHaveLength(1);
			// one round of raw tail is ~4.2 KB; the summary is the only other text
			expect(estimate(msgs) * 4).toBeLessThan(SUMMARY_FRAMING.length + latest.summary.length + 6_000);
		}
	});
});
