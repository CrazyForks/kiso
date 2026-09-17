/**
 * The summary call retries a dropped stream, once (0.39.1).
 *
 * `/compact` does not go through the kernel. Retry lives in the kernel
 * and only there (ADR-0005), and this path calls the adapter directly —
 * so a gateway that drops a long summary stream failed `/compact` EVERY
 * time, with an honest message and nothing the person could do about it.
 * Reported from a live session: a 6-round, ~95k-token compaction that
 * died at 19 s, reproducibly.
 *
 * The retry is keyed on the CLASSIFICATION the adapter already made, not
 * on the fact that something failed. That is the whole separation:
 *  - a transport failure after the headers is `{ retryable: true }` and
 *    is worth one more call;
 *  - a summary the model wrote badly is an E6 (b) validation rejection,
 *    a plain `Error`, and must NEVER be retried — retrying it pays for
 *    the same bad answer twice.
 *
 * ONE retry, not a loop. A summary re-pays its entire input, and on the
 * sessions that need compacting that is the most expensive request the
 * session makes.
 */

import { describe, expect, it } from "vitest";
import type { Adapter, AdapterEvent } from "@vincemakes/kiso-core";
import { summarizeConversation } from "../src/summarize.js";

const VALID = "## Goal\ng\n## Constraints\nc\n## User requests\nu\n## Files and changes\nf\n## Errors and fixes\ne\n## Current work\nw\n## Next steps\nn";

const text = (t: string): AdapterEvent => ({ type: "text_delta", text: t, seq: 0 }) as unknown as AdapterEvent;
const stop = (reason: string): AdapterEvent => ({ type: "stop", reason, seq: 0 }) as unknown as AdapterEvent;

/** What the adapters throw for the transport-failure class — the shape
 *  `streamFailure` produces, which is what a dropped stream now is. */
const DROPPED = { code: "network", retryable: true, message: "[gw] request failed: the stream ended with no finish reason" };

/** One run of the adapter: the events it yields, and optionally what it
 *  throws after them — a drop mid-answer is events THEN a throw, which is
 *  what the wire does and what a retry has to survive. */
type Run = { readonly events?: readonly AdapterEvent[]; readonly fail?: unknown };

/** An adapter that plays one run per call, counting the calls. */
function scripted(runs: readonly Run[]): { adapter: Adapter; calls: () => number } {
	let n = 0;
	const adapter = {
		stream: async function* () {
			const run = runs[Math.min(n, runs.length - 1)]!;
			n += 1;
			for (const ev of run.events ?? []) yield ev;
			if (run.fail !== undefined) throw run.fail;
		},
	} as unknown as Adapter;
	return { adapter, calls: () => n };
}

const ok = (): Run => ({ events: [text(VALID), stop("end_turn")] });
const dropped = (partial?: string): Run => ({ ...(partial !== undefined ? { events: [text(partial)] } : {}), fail: DROPPED });

const call = (adapter: Adapter, signal?: { aborted: boolean }) =>
	summarizeConversation({
		adapter,
		model: "faux",
		messages: [{ role: "user", content: "history" }],
		...(signal !== undefined ? { signal: signal as never } : {}),
	});

describe("the summary call retries a dropped stream, once", () => {
	it("a stream that drops, then one that completes: the summary lands", async () => {
		const { adapter, calls } = scripted([dropped(), ok()]);
		const r = await call(adapter);
		expect(r.text).toBe(VALID);
		expect(calls()).toBe(2);
	});

	it("the retry starts clean — the dropped attempt's half answer is not glued to the second", async () => {
		// The drop arrives mid-answer, which is the only way it ever
		// arrives: half the summary is already in hand when the socket
		// dies. A retry that kept it would persist a checkpoint made of two
		// attempts, and the second attempt's own "## Goal" would be the
		// document's second.
		const { adapter } = scripted([dropped("## Goal\nhalf an ans"), ok()]);
		const r = await call(adapter);
		expect(r.text).toBe(VALID);
		expect(r.text).not.toContain("half an ans");
	});

	it("a PERMANENT classified failure is one call and one throw", async () => {
		const permanent = { code: "invalid_request", retryable: false, message: "[gw] request failed: model not found" };
		const { adapter, calls } = scripted([{ fail: permanent }, ok()]);
		await expect(call(adapter)).rejects.toMatchObject({ code: "invalid_request", retryable: false });
		expect(calls()).toBe(1);
	});

	it("an E6 (b) validation rejection is never retried — a bad summary is not a dropped stream", async () => {
		// The model answered. It answered badly. Paying twice for the same
		// bad answer is not a recovery.
		const { adapter, calls } = scripted([{ events: [text("not the required sections"), stop("end_turn")] }, ok()]);
		await expect(call(adapter)).rejects.toThrow();
		expect(calls()).toBe(1);
	});

	it("a turn with no stop is a validation rejection too, and is not retried", async () => {
		const { adapter, calls } = scripted([{ events: [text(VALID)] }, ok()]);
		await expect(call(adapter)).rejects.toThrow("never stopped");
		expect(calls()).toBe(1);
	});

	it("a cancelled compaction does not spend a second call on its way out", async () => {
		const { adapter, calls } = scripted([dropped(), ok()]);
		await expect(call(adapter, { aborted: true })).rejects.toMatchObject({ retryable: true });
		expect(calls()).toBe(1);
	});

	it("two drops in a row end as a failure, still classified — the caller can say so", async () => {
		const { adapter, calls } = scripted([dropped(), dropped(), ok()]);
		await expect(call(adapter)).rejects.toMatchObject({ code: "network", retryable: true });
		expect(calls()).toBe(2); // one retry, not a loop
	});
});
