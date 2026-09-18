/**
 * 0.40.0 item 9 — when a resumed session is offered a compaction first.
 *
 * The owner's session re-sent a 727k prefix 27 minutes after its last
 * request, uncached. The offer stands only on a BILL: over the microcompact
 * threshold (window/2) and older than COLD_AFTER_MS. A session no bill
 * describes has no known size and no age, so it is never offered. The faux
 * model's window is the 200k fallback, so the threshold here is 100k.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Adapter, type AdapterEvent } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "@vincemakes/kiso-runtime";
import { COLD_AFTER_MS, coldAfter, coldResumeOffer } from "../src/chat.js";

const adapter = {
	stream: async function* (): AsyncIterable<AdapterEvent> {
		yield { type: "stop", reason: "end_turn", seq: 0 } as unknown as AdapterEvent;
	},
} as unknown as Adapter;

async function sessionBilled(billed: number | null) {
	const store = new SessionStore(mkdtempSync(join(tmpdir(), "kiso-cold-")));
	let seq = 0;
	await store.append("c", "r1", { seq: seq++, type: "user_input", content: "hi" });
	if (billed !== null) await store.append("c", "r1", { seq: seq++, type: "usage", inputTokens: billed, outputTokens: 1_000, cacheRead: billed - 100, cacheWrite: null, known: true });
	await store.append("c", "r1", { seq: seq++, type: "stop", reason: "end_turn" });
	await store.append("c", "r1", { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
	return (await createAgent({ model: "faux", store, tools: [], adapter })).session({ id: "c" });
}

describe("the cold-resume offer", () => {
	it("a bill over window/2, older than the cache lives: offered, with its size and its age", async () => {
		const session = await sessionBilled(149_000);
		const at = session.lastUsageAt!;
		expect(at).toBeGreaterThan(0);
		expect(coldResumeOffer(session, at + 27 * 60_000)).toEqual({ tokens: 150_000, minutes: 27 });
	});

	it("a warm cache, a small session, or no bill at all: no offer", async () => {
		const big = await sessionBilled(149_000);
		expect(coldResumeOffer(big, big.lastUsageAt! + COLD_AFTER_MS - 1)).toBeNull();
		const small = await sessionBilled(59_000);
		expect(coldResumeOffer(small, small.lastUsageAt! + 60 * 60_000)).toBeNull();
		const unbilled = await sessionBilled(null);
		expect(unbilled.lastUsageAt).toBeUndefined();
		expect(coldResumeOffer(unbilled, Date.now() + 60 * 60_000)).toBeNull();
	});
});

describe("the recap's cold-cache condition (0.40.0, the owner)", () => {
	const usage = (fresh: number, cache: number) => ({ known: true, in: fresh, out: 100, cache });

	it("idle past the cache's life and a surfaced miss: cold, in whole minutes", () => {
		expect(coldAfter(58 * 60_000 + 20_000, 727_000, usage(735_000, 3_456))).toEqual({ coldAfterMinutes: 58 });
	});
	it("no surfaced miss but under half the prompt from cache: cold", () => {
		expect(coldAfter(10 * 60_000, null, usage(600_000, 100_000))).toEqual({ coldAfterMinutes: 10 });
	});
	it("idle long, but the cache still answered: not cold — the time alone is not evidence", () => {
		expect(coldAfter(58 * 60_000, null, usage(2_000, 700_000))).toEqual({});
	});
	it("a short gap, or no bill to measure from, is never cold", () => {
		expect(coldAfter(COLD_AFTER_MS - 1, 727_000, usage(735_000, 0))).toEqual({});
		expect(coldAfter(undefined, 727_000, usage(735_000, 0))).toEqual({});
	});
});
