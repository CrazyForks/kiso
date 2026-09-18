/**
 * ADR-0005 Amendment 2, the CLI's half — the budget knob, and the retry
 * on the running row.
 *
 * The kernel's budget went from 2 to 10 and its backoff to a curve that
 * reaches 32 s. A retry that long with nothing on screen reads exactly
 * like a hung session, so the running row shows it —
 * `retrying 3/10 · network · 4s` — and shows it as a FACT: at a narrow
 * width the gesture hints give way, the retry never does.
 */

import { describe, expect, it } from "vitest";
import { compactingStatus, retrySegment, runningStatus } from "@vincemakes/kiso-tui";
import { displayWidth } from "@vincemakes/kiso-tui-cells/width";
import { MAX_RETRIES_CLAMP, maxRetriesFromEnv } from "../src/retries.js";

describe("KISO_MAX_RETRIES — the front door's knob, clamped", () => {
	it("absent or blank leaves the kernel's own default", () => {
		expect(maxRetriesFromEnv(undefined)).toBeUndefined();
		expect(maxRetriesFromEnv("")).toBeUndefined();
		expect(maxRetriesFromEnv("   ")).toBeUndefined();
	});

	it("a plain count is taken, zero included — zero means never retry", () => {
		expect(maxRetriesFromEnv("0")).toBe(0);
		expect(maxRetriesFromEnv("4")).toBe(4);
	});

	it("is CLAMPED: a typo cannot buy an hour of 32-second retries", () => {
		expect(MAX_RETRIES_CLAMP).toBe(15);
		expect(maxRetriesFromEnv("15")).toBe(15);
		expect(maxRetriesFromEnv("1000")).toBe(15);
	});

	it("nonsense is ignored rather than guessed at", () => {
		for (const bad of ["-1", "2.5", "ten", "NaN", "Infinity"]) expect(maxRetriesFromEnv(bad), bad).toBeUndefined();
	});
});

describe("the retry on the running row", () => {
	it("while waiting: attempt, budget, code, and whole seconds left, rounded UP", () => {
		expect(retrySegment({ attempt: 3, maxRetries: 10, code: "network", remainingMs: 3_200 })).toBe("retrying 3/10 · network · 4s");
		// never "0s" while a wait is still running
		expect(retrySegment({ attempt: 1, maxRetries: 10, code: "network", remainingMs: 40 })).toBe("retrying 1/10 · network · 1s");
	});

	it("once the wait is over the attempt is in flight, and the countdown goes", () => {
		expect(retrySegment({ attempt: 3, maxRetries: 10, code: "api_5xx", remainingMs: 0 })).toBe("retrying 3/10 · api_5xx");
		expect(retrySegment({ attempt: 3, maxRetries: 10, code: "api_5xx", remainingMs: -500 })).toBe("retrying 3/10 · api_5xx");
	});

	it("rides the row right after the head, and a row with no retry is the row it always was", () => {
		const since = Date.now() - 5_000;
		const plain = runningStatus("✦", since, 950, 0.2);
		expect(runningStatus("✦", since, 950, 0.2, null, undefined, null)).toBe(plain);
		const withRetry = runningStatus("✦", since, 950, 0.2, null, undefined, { attempt: 2, maxRetries: 10, code: "network", remainingMs: 1_500 });
		expect(withRetry).toContain("working 5s ↓ 950 tokens · retrying 2/10 · network · 2s · esc stop");
	});

	it("is a FACT: at a narrow width the hints give way and the retry stays", () => {
		const since = Date.now() - 5_000;
		const r = { attempt: 7, maxRetries: 10, code: "network", remainingMs: 30_000 };
		const full = runningStatus("✦", since, 20_300, 0.4, null, undefined, r);
		const narrow = runningStatus("✦", since, 20_300, 0.4, null, displayWidth(full) - 20, r);
		expect(narrow).toContain("retrying 7/10 · network · 30s");
		expect(narrow).not.toContain("alt+⏎ redirect"); // a hint went first
	});
});

describe("the retry on the compacting row — the summary call retries under the same policy", () => {
	it("rides after the elapsed seconds, and a row with no retry is the row it always was", () => {
		expect(compactingStatus("▘", 6, 95_100, 19, undefined, null)).toBe(compactingStatus("▘", 6, 95_100, 19));
		expect(compactingStatus("▘", 6, 95_100, 19, undefined, { attempt: 2, maxRetries: 10, code: "network", remainingMs: 1_200 })).toBe(
			"▘ compacting · 6 rounds · ~95.1k tokens · 19s · retrying 2/10 · network · 2s",
		);
	});

	it("the longest honest row still fits 80 columns", () => {
		const row = compactingStatus("▘", 40, 1_200_000, 312, undefined, { attempt: 10, maxRetries: 10, code: "network", remainingMs: 32_000 });
		expect(displayWidth(row)).toBeLessThanOrEqual(80);
	});
});
