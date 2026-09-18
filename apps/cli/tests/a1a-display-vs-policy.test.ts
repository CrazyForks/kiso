/**
 * A1a (R2.2) — the status line's headroom counts the parts; the
 * auto-compact policy keeps its own number. Same session: the displayed
 * ratio is the request budget (system + tools + messages + continuations
 * + reserve), the policy's ratio is the old messages-only estimate — and
 * the two differ whenever a tool table exists, which is always. The
 * policy's input is nameable (`autoCompactRatio`) so this gate can pin
 * that it did NOT move this round.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineTool, type Adapter, type AdapterEvent } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "@vincemakes/kiso-runtime";
import { autoCompactRatio, displayCtxRatio, estimateCtxRatio } from "../src/chat.js";
import { setAgentModel, setConfiguredWindow } from "../src/state.js";

const adapter = {
	stream: async function* (): AsyncIterable<AdapterEvent> {
		yield { type: "stop", reason: "end_turn", seq: 0 } as unknown as AdapterEvent;
	},
} as unknown as Adapter;

describe("A1a — display counts the parts, the policy does not move", () => {
	it("the same session: displayed headroom is smaller than the messages-only ratio implies; the policy reads the old number", async () => {
		const tools = Array.from({ length: 30 }, (_, i) =>
			defineTool({ name: `tool_${i}`, description: "d".repeat(300), parameters: { type: "object", properties: { a: { type: "string", description: "e".repeat(200) } } }, execute: async () => ({ content: "", isError: false }) }),
		);
		const agent = createAgent({ model: "faux", store: new SessionStore(mkdtempSync(join(tmpdir(), "kiso-a1a-"))), tools, adapter, systemPrompt: "s".repeat(4000) });
		const session = await agent.session({ id: "a1a-display" });
		// A WINDOW HAS TO EXIST for either ratio to mean anything, and this
		// case is about the NUMERATOR — the display counts the tool table and
		// the system prompt, the policy does not. It used to get its
		// denominator from a hardcoded 200,000 fallback without saying so;
		// now an unstated window makes the display refuse to divide, so the
		// case states its own denominator instead of leaning on a default.
		setConfiguredWindow(200_000);
		const policy = estimateCtxRatio(session);
		const display = displayCtxRatio(session);
		expect(display).toBeGreaterThan(policy); // the tool table and the system prompt are real
		expect(autoCompactRatio(session)).toBe(policy); // the policy's input is the old estimate, unchanged
		setConfiguredWindow(undefined);
	});

	it("with NO stated window the display refuses to divide, while the policy still has its number", async () => {
		// The two questions separate here: "how much is left" is unanswerable
		// without a window, but the compaction policy must still have a value
		// to compare against.
		//
		// NOT faux: faux is OURS and we declare its window, so it has an
		// answer. The live case is a vendor model nobody publishes a window
		// for — DeepSeek today — and an unregistered id stands for it here
		// without pinning this case to one vendor's current silence.
		setAgentModel("no-such-model-anyone-registered", undefined);
		const agent = createAgent({ model: "no-such-model-anyone-registered", store: new SessionStore(mkdtempSync(join(tmpdir(), "kiso-a1a-nw-"))), tools: [], adapter });
		const session = await agent.session({ id: "a1a-no-window" });
		setConfiguredWindow(undefined);
		expect(Number.isFinite(displayCtxRatio(session))).toBe(false);
		expect(Number.isFinite(autoCompactRatio(session))).toBe(true);
	});
});

describe("0.40.0 — the row and the policy read the last BILL when one describes the context", () => {
	it("a CJK context billed at 600k on a 1M window reads ~60% used on the row and to the policy, not the estimate's sliver", async () => {
		const store = new SessionStore(mkdtempSync(join(tmpdir(), "kiso-a1a-bill-")));
		await store.append("b", "r1", { seq: 0, type: "user_input", content: "\u4e2d\u6587".repeat(500) });
		await store.append("b", "r1", { seq: 1, type: "usage", inputTokens: 600_000, outputTokens: 2_000, cacheRead: 599_000, cacheWrite: null, known: true });
		await store.append("b", "r1", { seq: 2, type: "stop", reason: "end_turn" });
		await store.append("b", "r1", { seq: 3, type: "terminal", outcome: { kind: "completed" } });
		const agent = createAgent({ model: "faux", store, tools: [], adapter });
		const session = await agent.session({ id: "b" });
		setConfiguredWindow(1_000_000);
		expect(displayCtxRatio(session)).toBeCloseTo(0.602, 3);
		expect(autoCompactRatio(session)).toBeCloseTo(0.602, 3);
		setConfiguredWindow(undefined);
	});
});
