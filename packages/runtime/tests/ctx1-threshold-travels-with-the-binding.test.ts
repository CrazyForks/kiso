/**
 * CTX-1: the compaction threshold is a PASSENGER on the model binding.
 *
 * The threshold is derived from the live model's window, so it belongs to
 * the binding exactly the way the model id, the provider, the endpoint and
 * the continuation scope do. PH-F8 fixed that class for those four; this
 * was the field one over, and nobody asked it.
 *
 * The symptom was silent in both directions. Switching 200k -> 1M left the
 * session clearing tool results at 100,000 while the status row said
 * 1,000,000. Switching 1M -> 200k left it waiting for 500,000 in a window
 * that cannot hold that.
 *
 * The gate is behavioral: the boundary is written, or it is not. A session
 * that merely STORES a new number proves nothing about what the next run
 * reads.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { createAgent, SessionStore } from "../src/index.js";

const END: FauxScript = [{ events: [{ type: "stop", reason: "end_turn" }] }];

/** The same shape as the C-area e2e seed: chunky tool results a
 *  microcompact has something to clear. */
async function seedLongSession(store: SessionStore): Promise<void> {
	let seq = 0;
	await store.append("s", "r1", { seq: seq++, type: "user_input", content: "start" });
	for (let i = 0; i < 7; i++) {
		await store.append("s", "r1", {
			seq: seq++,
			type: "tool_call_end",
			callId: `r${i}`,
			name: "read_file",
			input: { path: `f${i}.ts` },
		});
		await store.append("s", "r1", {
			seq: seq++,
			type: "tool_result",
			callId: `r${i}`,
			content: "line\n".repeat(200),
			isError: false,
		});
		await store.append("s", "r1", { seq: seq++, type: "user_input", content: `t${i}` });
	}
}

async function runAndCountBoundaries(
	startupThreshold: number,
	switchTo: { readonly thresholdTokens: number } | undefined,
): Promise<number> {
	const dir = mkdtempSync(join(tmpdir(), "kiso-ctx1-"));
	const store = new SessionStore(dir);
	await seedLongSession(store);
	const adapter = createFauxProvider(END);
	const agent = createAgent({
		model: "faux",
		store,
		tools: [],
		adapter,
		microcompact: { thresholdTokens: startupThreshold },
	});
	const session = await agent.session({ id: "s" });
	session.setModelBinding({
		adapter,
		model: "faux-2",
		...(switchTo !== undefined ? { microcompact: switchTo } : {}),
	});
	for await (const _ of session.resume()) {
		// drain
	}
	return new SessionStore(dir)
		.load("s")
		.map((r) => r.event)
		.filter((e) => e.type === "microcompacted").length;
}

async function runWithSetter(startupThreshold: number, setTo: number | undefined): Promise<number> {
	const dir = mkdtempSync(join(tmpdir(), "kiso-ctx1r-"));
	const store = new SessionStore(dir);
	await seedLongSession(store);
	const agent = createAgent({
		model: "faux",
		store,
		tools: [],
		adapter: createFauxProvider(END),
		microcompact: { thresholdTokens: startupThreshold },
	});
	const session = await agent.session({ id: "s" });
	if (setTo !== undefined) session.setMicrocompactThreshold(setTo);
	for await (const _ of session.resume()) {
		// drain
	}
	return new SessionStore(dir)
		.load("s")
		.map((r) => r.event)
		.filter((e) => e.type === "microcompacted").length;
}

describe("CTX-1: a model switch moves the threshold the NEXT RUN reads", () => {
	it("switching to a SMALLER window compacts a session the startup threshold left alone", async () => {
		// Startup threshold far above this session: nothing to do.
		expect(await runAndCountBoundaries(1_000_000, undefined)).toBe(0);
		// Same session, same bytes — only the binding's threshold differs.
		expect(await runAndCountBoundaries(1_000_000, { thresholdTokens: 100 })).toBe(1);
	});

	it("switching to a LARGER window stops compacting a session the startup threshold would have cleared", async () => {
		expect(await runAndCountBoundaries(100, undefined)).toBe(1);
		expect(await runAndCountBoundaries(100, { thresholdTokens: 1_000_000 })).toBe(0);
	});

	it("a binding that does not name a threshold KEEPS the current one — absent is not zero", async () => {
		// A caller that does not know the new model's window must not
		// silently reset the policy. `undefined` above is exactly this case:
		// the startup threshold is still in force after the switch, which is
		// what makes the first assertion of each test above meaningful.
		expect(await runAndCountBoundaries(100, undefined)).toBe(1);
	});
});

/**
 * The OTHER door. `/resume` restores the model recorded in the durable
 * profile, which need not be the model this process was configured with —
 * so the session can open onto a window the startup threshold knows
 * nothing about. A fix that only covered `/model` would leave this one.
 */
describe("CTX-1: a session OPENED onto another model takes that model's threshold", () => {
	it("the threshold can be brought into line with a model already in force", async () => {
		expect(await runWithSetter(1_000_000, undefined)).toBe(0);
		expect(await runWithSetter(1_000_000, 100)).toBe(1);
	});

	it("and in the other direction — a resumed large-window session stops compacting early", async () => {
		expect(await runWithSetter(100, undefined)).toBe(1);
		expect(await runWithSetter(100, 1_000_000)).toBe(0);
	});
});

/**
 * The guarantee the 100k/500k diagnostic rests on.
 *
 * That experiment sets KISO_POLICY_MICROCOMPACT and NOTHING else — the
 * window env is off the table because it also arms auto-summary, which
 * would be a second variable. The experiment is only valid if the armed
 * policy still beats both doors added here. If a session open silently
 * overwrote the armed value, the two legs would run the same threshold
 * and the diagnostic would measure nothing while reporting cleanly.
 */
describe("CTX-1: an ARMED policy still beats both doors", () => {
	async function armedThenMoved(armed: number, moveTo: number): Promise<number> {
		const dir = mkdtempSync(join(tmpdir(), "kiso-ctx1p-"));
		const store = new SessionStore(dir);
		await seedLongSession(store);
		const adapter = createFauxProvider(END);
		const agent = createAgent({
			model: "faux",
			store,
			tools: [],
			adapter,
			microcompact: { thresholdTokens: 1_000_000 },
			contextPolicy: { microcompact: { thresholdTokens: armed } },
		});
		const session = await agent.session({ id: "s" });
		// Both doors, in the order a real resume-then-switch takes them.
		session.setMicrocompactThreshold(moveTo);
		session.setModelBinding({ adapter, model: "faux-2", microcompact: { thresholdTokens: moveTo } });
		for await (const _ of session.resume()) {
			// drain
		}
		return new SessionStore(dir)
			.load("s")
			.map((r) => r.event)
			.filter((e) => e.type === "microcompacted").length;
	}

	it("an armed LOW threshold still fires when both doors say high", async () => {
		expect(await armedThenMoved(100, 1_000_000)).toBe(1);
	});

	it("an armed HIGH threshold still suppresses when both doors say low", async () => {
		expect(await armedThenMoved(1_000_000, 100)).toBe(0);
	});
});
