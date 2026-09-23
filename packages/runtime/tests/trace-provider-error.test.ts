import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";
import { RequestTracer, redactProviderMessage } from "../src/trace/guard.js";
import { TRACE_SCHEMA_VERSION, validateTraceRecord } from "../src/trace/record.js";

/**
 * SMK0400-F1 (0.40.7) — a failed request says what the provider said.
 *
 * The 0.40.0 smoke had two `provider_error` records and no way to name
 * either: the record carried the outcome and nothing else. v7 records the
 * error's code, the HTTP status when there was one, and the message — capped
 * and redacted before it reaches the disk.
 *
 * These drive the REAL tracer and read the record it wrote (F33-R8's
 * lesson: a gate that re-states the rule passes on unfixed code).
 */
async function written(fail: unknown | null): Promise<Record<string, unknown>> {
	const root = mkdtempSync(join(tmpdir(), "kiso-provider-error-"));
	const tracer = new RequestTracer({ root, sessionId: "s1", runId: "run-1", provider: "openai-compat", model: "m", log: [{ seq: 1, type: "user_input", content: "hi" }] });
	tracer.init();
	const options: StreamOptions = { model: "m", messages: [{ role: "user", content: "hi" }], systemPrompt: "s" };
	const stream = async function* (): AsyncIterable<AdapterEvent> {
		yield { seq: 0, type: "text_delta", text: "par" } as AdapterEvent;
		if (fail !== null) throw fail;
		yield { seq: 0, type: "usage", inputTokens: 10, outputTokens: 2, cacheRead: 0, cacheWrite: null, known: true } as unknown as AdapterEvent;
		yield { seq: 0, type: "stop", reason: "end_turn" } as AdapterEvent;
	};
	try {
		for await (const _ of tracer.wrap(options, stream())) {
			// drain
		}
	} catch {
		// the adapter's error is re-thrown to the kernel, as it must be
	} finally {
		await new Promise<void>((r) => setImmediate(r));
	}
	const last = readFileSync(join(root, "traces", "s1.jsonl"), "utf8").split("\n").filter(Boolean).at(-1);
	if (last === undefined) throw new Error("the tracer wrote no record");
	return JSON.parse(last) as Record<string, unknown>;
}

describe("SMK0400-F1: a provider_error record names the failure", () => {
	it("the structured error's code, status and message are on the record, and it validates at v7", async () => {
		const rec = await written({ code: "rate_limit", retryable: true, status: 429, message: "[deepseek] request failed: 429 too many requests" });
		expect(rec.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
		expect(rec.outcome).toBe("provider_error");
		expect(rec.providerError).toEqual({ code: "rate_limit", status: 429, message: "[deepseek] request failed: 429 too many requests" });
		expect(validateTraceRecord(rec)).toBe(true);
	});

	it("a status-less failure (the stream error frame) records no status; a thrown Error is named by its name", async () => {
		const frame = await written({ code: "network", retryable: true, message: "[deepseek] request failed: Upstream stream ended before terminal chunk" });
		expect(frame.providerError).toEqual({ code: "network", message: "[deepseek] request failed: Upstream stream ended before terminal chunk" });
		const thrown = await written(new TypeError("terminated"));
		expect(thrown.providerError).toEqual({ code: "TypeError", message: "terminated" });
		expect(validateTraceRecord(thrown)).toBe(true);
	});

	it("an ok request carries none", async () => {
		const rec = await written(null);
		expect(rec.outcome).toBe("ok");
		expect("providerError" in rec).toBe(false);
	});

	it("nothing credential-shaped reaches the disk, and the message is capped", async () => {
		const rec = await written({
			code: "invalid_request",
			status: 401,
			message: "Incorrect API key provided: sk-proj-AbCdEf0123456789xyz. Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig api_key=supersecretvalue " + "q".repeat(40),
		});
		const note = rec.providerError as { message: string };
		for (const leak of ["AbCdEf0123456789", "eyJhbGciOiJIUzI1NiJ9", "supersecretvalue", "q".repeat(40)]) expect(note.message, leak).not.toContain(leak);
		expect(note.message).toContain("Incorrect API key provided");
		expect(redactProviderMessage("word ".repeat(200))).toHaveLength(300);
		expect(validateTraceRecord(rec)).toBe(true);
	});
});
