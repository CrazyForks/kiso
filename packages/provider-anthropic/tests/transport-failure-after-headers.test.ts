/**
 * The transport-failure-after-headers class (0.39.1), anthropic half.
 *
 * The rule and its controls are stated in full in the Responses adapter's
 * file of the same name: once the headers are in the request has been
 * ACCEPTED, so nothing that fails afterwards is a verdict on it.
 *
 * This adapter's member of the class is the quietest of the three. It
 * emitted no stop event at all when the stream ended early, and the run
 * died on the KERNEL's adapter-contract check — "provider stream ended
 * without a stop event", `invalid_request`, non-retryable. That reads as
 * a bug in kiso's own adapter, which is exactly what it is not: it is
 * someone else's dropped connection, and the contract check should keep
 * meaning what it says.
 */

import { describe, expect, it } from "vitest";
import type { AdapterEvent } from "@vincemakes/kiso-core";
import { createAnthropicAdapter } from "../src/index.js";

const OPTS = { model: "claude-x", messages: [{ role: "user" as const, content: "go" }] };

function streaming(events: readonly unknown[]) {
	return {
		messages: {
			stream: () => ({
				async *[Symbol.asyncIterator]() {
					for (const ev of events) yield ev;
				},
				abort: () => {},
			}),
		},
	};
}

const OPENED = [
	{ type: "message_start", message: { usage: { input_tokens: 5 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "half an answ" } },
];

async function collect(events: readonly unknown[]): Promise<AdapterEvent[]> {
	const out: AdapterEvent[] = [];
	for await (const ev of createAnthropicAdapter(streaming(events) as never).stream(OPTS)) out.push(ev);
	return out;
}

describe("a failure AFTER the headers is retryable (anthropic)", () => {
	it("a stream that ENDS with no message_stop throws retryable rather than failing the adapter contract", async () => {
		await expect(collect(OPENED)).rejects.toMatchObject({ code: "network", retryable: true });
	});
});

describe("the controls — what this class does NOT reach", () => {
	it("a message_stop the provider DID send stays a stop event, even with no stop_reason", async () => {
		// D3: the provider signalled its end and named no reason for it.
		// That is a verdict we do not understand, not a stream that broke —
		// it keeps the error stop it has always had.
		const events = await collect([...OPENED, { type: "content_block_stop", index: 0 }, { type: "message_stop" }]);
		expect(events[events.length - 1]).toMatchObject({ type: "stop", reason: "error" });
	});

	it("a normal turn is untouched", async () => {
		const events = await collect([
			...OPENED,
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
			{ type: "message_stop" },
		]);
		expect(events[events.length - 1]).toMatchObject({ type: "stop", reason: "end_turn" });
	});
});
