import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";
import { RequestTracer } from "../src/trace/guard.js";

/**
 * RSN-1, the second half: the split has to reach the RECORD.
 *
 * `canonical.reasoning` was hardcoded null, so a gate that stopped at the
 * adapter would have been green while every trace still said nothing. The
 * value crosses four hops and the last two are here.
 */
async function written(usage: Record<string, unknown>): Promise<Record<string, unknown>> {
	const root = mkdtempSync(join(tmpdir(), "kiso-rsn1-"));
	const tracer = new RequestTracer({
		root,
		sessionId: "s1",
		runId: "run-1",
		provider: "openai-compat",
		model: "m",
		log: [{ seq: 1, type: "user_input", content: "hi" }],
	});
	tracer.init();
	const options: StreamOptions = { model: "m", messages: [{ role: "user", content: "hi" }], systemPrompt: "s" };
	const stream = async function* (): AsyncIterable<AdapterEvent> {
		yield { seq: 0, type: "usage", inputTokens: 10, outputTokens: 76, cacheRead: 2, cacheWrite: null, known: true, ...usage } as unknown as AdapterEvent;
		yield { seq: 0, type: "stop", reason: "end_turn" } as AdapterEvent;
	};
	try {
		for await (const _ of tracer.wrap(options, stream())) {
			// drain
		}
	} finally {
		await new Promise<void>((r) => setImmediate(r));
	}
	const last = readFileSync(join(root, "traces", "s1.jsonl"), "utf8").split("\n").filter(Boolean).at(-1);
	if (last === undefined) throw new Error("the tracer wrote no record");
	return JSON.parse(last) as Record<string, unknown>;
}

describe("RSN-1: the thinking split reaches the canonical block", () => {
	it("a reported split is written, and the output still holds the whole", async () => {
		const rec = await written({ reasoningTokens: 41 });
		const c = rec.canonical as Record<string, number | null>;
		expect(c.reasoning, "the guard dropped it between the event and canonicalization").toBe(41);
		expect(c.output, "the split is INSIDE the output — subtracting it would double-count").toBe(76);
	});

	it("no split reported writes null, not zero", async () => {
		const rec = await written({});
		const c = rec.canonical as Record<string, number | null>;
		expect(c.reasoning, "a provider that reports no split has not measured zero thinking").toBeNull();
		expect(c.output).toBe(76);
	});

	it("a REPORTED zero is written as zero — the provider measured it", async () => {
		const rec = await written({ reasoningTokens: 0 });
		const c = rec.canonical as Record<string, number | null>;
		expect(c.reasoning).toBe(0);
	});
});
