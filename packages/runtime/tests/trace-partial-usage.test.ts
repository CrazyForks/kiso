import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";
import { RequestTracer } from "../src/trace/guard.js";
import { validateTraceRecord } from "../src/trace/record.js";

/**
 * F33-R3 — `known` is not completeness, and the trace said it was.
 *
 * Core's contract: `known: true` means AT LEAST ONE usage field was
 * reported; the rest may be null, and canonicalization then fills the
 * unreported ones with zero. Copying that boolean into `usageKnown` handed
 * every consumer a measured zero for a field nobody measured — the same
 * "unknown is not zero" defect the marker exists to close, one level down.
 *
 * F33-R8, on the FIRST repair of it: the gate defined its own copy of the
 * completeness rule and asserted against the copy, so it passed on an
 * unfixed runtime. That is the one thing a regression gate must never do,
 * and it is the second time in this round — F34-R1 read a signal that
 * survived the failure it guarded. These cases drive the REAL tracer and
 * read the record it wrote.
 */
function testTracer() {
	const root = mkdtempSync(join(tmpdir(), "kiso-partial-"));
	const tracer = new RequestTracer({
		root,
		sessionId: "s1",
		runId: "run-1",
		provider: "openai-compat",
		model: "m",
		log: [{ seq: 1, type: "user_input", content: "hi" }],
	});
	tracer.init();
	return { tracer, root };
}

const options: StreamOptions = { model: "m", messages: [{ role: "user", content: "hi" }], systemPrompt: "sys" };

function streamWith(usage: Partial<Record<"inputTokens" | "outputTokens" | "cacheRead" | "cacheWrite", number | null>> & { known: boolean }) {
	return async function* (): AsyncIterable<AdapterEvent> {
		yield { seq: 0, type: "usage", cacheWrite: null, ...usage } as unknown as AdapterEvent;
		yield { seq: 0, type: "stop", reason: "end_turn" } as AdapterEvent;
	};
}

async function written(usage: Parameters<typeof streamWith>[0]): Promise<Record<string, unknown>> {
	const { tracer, root } = testTracer();
	try {
		for await (const _ of tracer.wrap(options, streamWith(usage)())) {
			// drain
		}
	} finally {
		await new Promise<void>((r) => setImmediate(r));
	}
	const last = readFileSync(join(root, "traces", "s1.jsonl"), "utf8").split("\n").filter(Boolean).at(-1);
	return JSON.parse(last as string) as Record<string, unknown>;
}

describe("F33-R3: a partially reported usage is not a complete one", () => {
	it("every field reported — the record says complete", async () => {
		const rec = await written({ inputTokens: 100, cacheRead: 20, outputTokens: 5, known: true });
		expect(rec.usageKnown).toBe(true);
	});

	it("a REPORTED zero is still complete — 0 is a measurement, null is not", async () => {
		const rec = await written({ inputTokens: 0, cacheRead: 0, outputTokens: 0, known: true });
		expect(rec.usageKnown).toBe(true);
	});

	it.each([
		["output", { inputTokens: 100, cacheRead: 20, outputTokens: null }],
		["input", { inputTokens: null, cacheRead: 20, outputTokens: 5 }],
		["cacheRead", { inputTokens: 100, cacheRead: null, outputTokens: 5 }],
	])("known:true with %s unreported is NOT complete, and the zero it canonicalizes to proves why", async (_name, usage) => {
		const rec = await written({ ...(usage as Record<string, number | null>), known: true } as never);
		expect(rec.usageKnown, "the writer copied `known` instead of measuring completeness").toBe(false);
		// the mechanism, from the record the writer actually produced: the
		// unreported field is a zero by the time anyone can read it.
		const canonical = rec.canonical as Record<string, number>;
		expect(Object.values(canonical).some((v) => v === 0)).toBe(true);
	});

	it("no usage at all is not complete either", async () => {
		const rec = await written({ inputTokens: null, cacheRead: null, outputTokens: null, known: false });
		expect(rec.usageKnown).toBe(false);
	});

	it("the validator refuses a non-boolean marker (F33-R8)", async () => {
		const rec = await written({ inputTokens: 1, cacheRead: 1, outputTokens: 1, known: true });
		expect(validateTraceRecord(rec)).toBe(true);
		expect(validateTraceRecord({ ...rec, usageKnown: "yes" })).toBe(false);
		expect(validateTraceRecord({ ...rec, usageKnown: 1 })).toBe(false);
	});
});
