/**
 * The summary call retries a dropped stream (0.39.1), under the kernel's
 * policy (0.40.0, ADR-0005 Amendment 2).
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
 * 0.39.1 allowed ONE retry after 250 ms, on the ground that a summary
 * re-pays its entire input. Amendment 2 replaced that with the kernel's
 * own rule: a dropped summary stream is the same failure as a dropped
 * turn, meeting the same gateway, and a turn's retry re-pays ITS input
 * too. So the same curve, the same budget and knob, Retry-After as a
 * floor, the cap as an explicit stop, and the same announcement.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_RETRIES, RETRY_AFTER_MAX_MS, type Adapter, type AdapterEvent, type RetryInfo } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
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

const call = (adapter: Adapter, signal?: { aborted: boolean }, extra: { maxRetries?: number; onRetry?: (i: RetryInfo) => Promise<void> | void } = {}) =>
	summarizeConversation({
		adapter,
		model: "faux",
		messages: [{ role: "user", content: "history" }],
		...(signal !== undefined ? { signal: signal as never } : {}),
		...extra,
	});

describe("the summary call retries a dropped stream", () => {
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

	// RETIRED at 0.40.0 with the rule it stated — "two drops in a row end
	// as a failure ... one retry, not a loop". ADR-0005 Amendment 2 put the
	// summary call under the kernel's budget. What survives is the half
	// that was never about the count: a budget spent ends as a failure that
	// is STILL CLASSIFIED, so the caller can say the connection dropped.
	it("a spent budget ends as a failure, still classified — the caller can say so", async () => {
		const { adapter, calls } = scripted([dropped(), dropped(), dropped(), ok()]);
		await expect(call(adapter, undefined, { maxRetries: 2 })).rejects.toMatchObject({ code: "network", retryable: true });
		expect(calls()).toBe(3); // the first attempt and two retries
	});
});

describe("ADR-0005 Amendment 2 — the kernel's policy, on the call the kernel does not make", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("the default budget is the kernel's: ten retries, eleven calls, on the kernel's curve", async () => {
		vi.useFakeTimers();
		const seen: RetryInfo[] = [];
		const { adapter, calls } = scripted([dropped()]);
		const p = call(adapter, undefined, { onRetry: (i) => void seen.push(i) });
		const settled = p.catch((e: unknown) => e);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(await settled).toMatchObject({ code: "network", retryable: true });
		expect(calls()).toBe(DEFAULT_MAX_RETRIES + 1);
		// Announced before each wait, with the kernel's delays: 500 ms
		// doubling to 32 s, plus at most a quarter.
		expect(seen.map((i) => i.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(seen.every((i) => i.maxRetries === DEFAULT_MAX_RETRIES && i.code === "network")).toBe(true);
		seen.forEach((i, k) => {
			const base = Math.min(500 * 2 ** k, 32_000);
			expect(i.delayMs).toBeGreaterThanOrEqual(base);
			expect(i.delayMs).toBeLessThanOrEqual(Math.round(base * 1.25));
		});
	});

	it("the announcement comes BEFORE the wait, and the retry waits for its delay", async () => {
		vi.useFakeTimers();
		const order: string[] = [];
		let n = 0;
		const adapter = {
			stream: async function* () {
				n += 1;
				order.push(`call ${n}`);
				if (n === 1) throw DROPPED;
				yield text(VALID);
				yield stop("end_turn");
			},
		} as unknown as Adapter;
		const p = call(adapter, undefined, { onRetry: (i) => void order.push(`retry ${i.attempt} in ${i.delayMs}`) });
		await vi.advanceTimersByTimeAsync(0);
		expect(order).toHaveLength(2); // called once, announced — and waiting
		expect(order[1]).toMatch(/^retry 1 in \d+$/);
		await vi.advanceTimersByTimeAsync(499);
		expect(n).toBe(1); // no retry before the curve's first 500 ms
		await vi.advanceTimersByTimeAsync(200);
		expect(n).toBe(2);
		expect((await p).text).toBe(VALID);
	});

	it("Retry-After is a floor, never shortened", async () => {
		vi.useFakeTimers();
		const seen: RetryInfo[] = [];
		const { adapter, calls } = scripted([{ fail: { ...DROPPED, code: "rate_limit", retryAfterMs: 5_000 } }, ok()]);
		const p = call(adapter, undefined, { onRetry: (i) => void seen.push(i) });
		await vi.advanceTimersByTimeAsync(4_900);
		expect(calls()).toBe(1);
		await vi.advanceTimersByTimeAsync(200);
		expect(calls()).toBe(2);
		expect((await p).text).toBe(VALID);
		expect(seen[0]!.delayMs).toBe(5_000);
	});

	it("a Retry-After beyond the cap is an explicit stop — never a retry that comes early", async () => {
		// 0.39.1 waited 250 ms instead and retried: early, against the
		// provider's own ask. The kernel never did; now neither does this.
		const seen: RetryInfo[] = [];
		const { adapter, calls } = scripted([{ fail: { ...DROPPED, code: "rate_limit", retryAfterMs: RETRY_AFTER_MAX_MS + 60_000 } }, ok()]);
		const err = (await call(adapter, undefined, { onRetry: (i) => void seen.push(i) }).catch((e: unknown) => e)) as { retryable: boolean; message: string };
		expect(calls()).toBe(1);
		expect(seen).toEqual([]);
		expect(err.retryable).toBe(false);
		expect(err.message).toMatch(/cap; not retried/);
	});

	it("a cancel during the wait wakes it at once and spends no further call", async () => {
		const controller = new AbortController();
		const { adapter, calls } = scripted([{ fail: { ...DROPPED, retryAfterMs: 30_000 } }, ok()]);
		const t0 = Date.now();
		setTimeout(() => controller.abort(), 100);
		await expect(call(adapter, controller.signal as never)).rejects.toMatchObject({ code: "network" });
		expect(Date.now() - t0).toBeLessThan(5_000); // not the 30 s wait
		expect(calls()).toBe(1);
	});

	it("a throwing observer changes nothing — the retry still happens", async () => {
		const { adapter, calls } = scripted([dropped(), ok()]);
		const r = await call(adapter, undefined, {
			onRetry: () => {
				throw new Error("a broken status row");
			},
		});
		expect(r.text).toBe(VALID);
		expect(calls()).toBe(2);
	});
});

describe("the session hands the summary call its budget and its hook", () => {
	async function longSession(adapter: Adapter, extra: { maxRetries?: number; onRetry?: (i: RetryInfo) => Promise<void> }) {
		const store = new SessionStore(mkdtempSync(join(tmpdir(), "kiso-sumretry-")));
		let seq = 0;
		for (let i = 0; i < 9; i++) {
			await store.append("s", "r1", { seq: seq++, type: "user_input", content: `turn ${i}` });
			await store.append("s", "r1", { seq: seq++, type: "tool_call_end", callId: `r${i}`, name: "read_file", input: { path: `f${i}.ts` } });
			await store.append("s", "r1", { seq: seq++, type: "tool_result", callId: `r${i}`, content: "export const x = 1;\n".repeat(50), isError: false });
		}
		await store.append("s", "r1", { seq: seq++, type: "user_input", content: "final" });
		await store.append("s", "r1", { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
		const agent = createAgent({
			model: "faux",
			store,
			tools: [],
			adapter,
			...(extra.maxRetries !== undefined ? { maxRetries: extra.maxRetries } : {}),
			...(extra.onRetry !== undefined ? { hooks: { onRetry: extra.onRetry } } : {}),
		});
		return agent.session({ id: "s" });
	}

	it("/compact's retry is announced through the session's hooks — the same path the kernel's takes", async () => {
		const seen: RetryInfo[] = [];
		const { adapter, calls } = scripted([dropped(), ok()]);
		const session = await longSession(adapter, { onRetry: async (i) => void seen.push(i) });
		const result = await session.summarize({ manualBudget: true });
		expect(result).not.toBeNull();
		expect(calls()).toBe(2);
		expect(seen.map((i) => [i.attempt, i.maxRetries, i.code])).toEqual([[1, DEFAULT_MAX_RETRIES, "network"]]);
	});

	it("the session's maxRetries bounds the summary call too — one knob for both", async () => {
		const { adapter, calls } = scripted([dropped()]);
		// zero is the discriminating value: 0.39.1's one fixed retry made two
		// calls whatever the session said
		const session = await longSession(adapter, { maxRetries: 0 });
		await expect(session.summarize({ manualBudget: true })).rejects.toMatchObject({ code: "network" });
		expect(calls()).toBe(1);
	});
});
