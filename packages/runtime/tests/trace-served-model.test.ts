import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";
import { RequestTracer } from "../src/trace/guard.js";
import { validateTraceRecord, TRACE_SCHEMA_VERSION } from "../src/trace/record.js";

/**
 * TRACE-F1 — the id we ASKED for and the id the server SERVED are two
 * facts, and until now the trace carried only the first.
 *
 * The bench ran every leg against `deepseek-v4-flash` for four days while
 * the server served `deepseek-flash` (the requested name is a retired
 * alias). The specified-vs-observed reconciliation built to catch exactly
 * that never fired, because nothing produced the observed half.
 *
 * These drive the REAL tracer and read the record it wrote — the lesson of
 * F33-R8, where a gate asserted against its own copy of the rule and
 * passed on unfixed code.
 */
async function written(usage: Record<string, unknown>): Promise<Record<string, unknown>> {
	const root = mkdtempSync(join(tmpdir(), "kiso-served-"));
	const tracer = new RequestTracer({
		root,
		sessionId: "s1",
		runId: "run-1",
		provider: "openai-compat",
		model: "deepseek-v4-flash",
		log: [{ seq: 1, type: "user_input", content: "hi" }],
	});
	tracer.init();
	const options: StreamOptions = { model: "deepseek-v4-flash", messages: [{ role: "user", content: "hi" }], systemPrompt: "s" };
	const stream = async function* (): AsyncIterable<AdapterEvent> {
		yield { seq: 0, type: "usage", inputTokens: 10, outputTokens: 2, cacheRead: 0, cacheWrite: null, known: true, ...usage } as unknown as AdapterEvent;
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

describe("TRACE-F1: the served id is the server's statement, recorded as its own fact", () => {
	it("a served id DIFFERENT from the requested one is on the record, and so is the request", async () => {
		const rec = await written({ servedModel: "deepseek-flash" });
		expect(rec.model, "the requested id must survive — these are two facts, never merged").toBe("deepseek-v4-flash");
		expect(rec.servedModel, "the alias the bench could not see for four days").toBe("deepseek-flash");
	});

	it("a server that states nothing leaves the field ABSENT — never the requested id", async () => {
		const rec = await written({});
		expect("servedModel" in rec, "writing the requested id here manufactures the agreement the reconciliation tests").toBe(false);
	});

	it("the record still validates, at the version that introduced the field", async () => {
		const rec = await written({ servedModel: "deepseek-flash" });
		expect(rec.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
		expect(validateTraceRecord(rec)).toBe(true);
	});

	it("an EMPTY served id is refused — that is a field we failed to read, not a statement", async () => {
		const rec = await written({ servedModel: "deepseek-flash" });
		expect(validateTraceRecord({ ...rec, servedModel: "" })).toBe(false);
		expect(validateTraceRecord({ ...rec, servedModel: 7 })).toBe(false);
	});
});
