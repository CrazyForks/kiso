/**
 * ADR-0055 Amendment 1 (A1b) — the in-run tiers, the phase detector, the
 * in-band summary with its one fallback, the guarded prune, and overflow.
 *
 * The session gates run on a 200k window: soft 100k, hard 160k, emergency
 * 200k − 32k = 168k, tail 20k. The context size is the §1a figure, so a
 * scripted usage event moves it; the seeded rounds give the boundary room
 * to keep a 20k tail.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { defineTool, projectMessages, type Adapter, type Message, type StreamOptions } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { SUMMARY_IN_BAND, SUMMARY_PROMPT } from "../src/summarize.js";
import { breakEvenFactor, guardedPruneSeq, phaseEnd, pruneBreaksEven, runsACheck, tierReason, tiersFor } from "../src/compaction-policy.js";

describe("the tiers, as ruled", () => {
	it("a 1M window: soft 400K, hard 700K, emergency window − reserve, tail 100K (v1)", () => {
		expect(tiersFor(1_000_000, 32_000)).toEqual({ soft: 400_000, hard: 700_000, emergency: 968_000, tail: 100_000 });
	});
	it("a 200k window: soft 100k, hard 160k, emergency 168k, tail 20k", () => {
		expect(tiersFor(200_000, 32_000)).toEqual({ soft: 100_000, hard: 160_000, emergency: 168_000, tail: 20_000 });
	});
	it("emergency never falls below hard: DeepSeek's 384K output on 1M, and a small window", () => {
		expect(tiersFor(1_000_000, 384_000).emergency).toBe(700_000);
		expect(tiersFor(600, 32_000)).toEqual({ soft: 300, hard: 480, emergency: 480, tail: 60 });
	});
});

describe("A1B-M1 (the lead's ruling) — at the clamp, the shared boundary is hard", () => {
	it("emergency = hard on a small window: a fire there is `hard`, so it is not prune-eligible", () => {
		const t = tiersFor(600, 32_000); // hard = emergency = 480
		expect(tierReason(500, t, "request", () => null)).toBe("hard");
	});
	it("emergency strictly above hard: past it is `emergency`, between the two is `hard`", () => {
		const t = tiersFor(200_000, 32_000); // hard 160k, emergency 168k
		expect(tierReason(170_000, t, "request", () => null)).toBe("emergency");
		expect(tierReason(165_000, t, "request", () => null)).toBe("hard");
	});
	it("soft asks the phase detector; an overflow outranks every tier", () => {
		const t = tiersFor(200_000, 32_000);
		expect(tierReason(120_000, t, "request", () => "phase:check")).toBe("phase:check");
		expect(tierReason(120_000, t, "request", () => null)).toBeNull();
		expect(tierReason(10, t, "overflow", () => null)).toBe("overflow");
	});
});

describe("phase rule 1 — what counts as running the checks", () => {
	it.each(["npm test", "npm run test -- --watch=false", "NODE_ENV=test npx vitest run", "cd app && pytest -q", "timeout 60 go test ./...", "env CI=1 cargo test"])("%s is a check", (cmd) => {
		expect(runsACheck(cmd)).toBe(true);
	});
	it.each(["npm install", "ls -la", "npm testify", "cat pytest.ini", "git commit -m test"])("%s is not", (cmd) => {
		expect(runsACheck(cmd)).toBe(false);
	});
	it("the user's configured checks come first", () => {
		expect(runsACheck("npm run check", ["npm run check"])).toBe(true);
		expect(runsACheck("npm run check")).toBe(false);
	});
});

describe("A3 — the phase detector reads the last settled round", () => {
	let seq = 0;
	const round = (...calls: [string, Record<string, unknown>][]) => [
		...calls.map(([name, input], i) => ({ seq: seq++, type: "tool_call_end" as const, callId: `k${seq}-${i}`, name, input })),
		{ seq: seq++, type: "stop" as const, reason: "tool_use" as const },
	];
	const detect = (events: unknown[]) => phaseEnd(events as never, -1, (c) => runsACheck(c));

	it("a check round ends a phase", () => {
		expect(detect([...round(["read_file", { path: "a" }]), ...round(["shell", { command: "npm test" }])])).toBe("phase:check");
	});
	it("the first round without edits after edits ends one", () => {
		expect(detect([...round(["edit_file", { path: "a" }]), ...round(["read_file", { path: "a" }])])).toBe("phase:edits-done");
	});
	it("the first edit round after reads ends one", () => {
		expect(detect([...round(["read_file", { path: "a" }]), ...round(["write_file", { path: "b" }])])).toBe("phase:reads-done");
	});
	it("a new user turn is a phase end of its own", () => {
		expect(detect([...round(["read_file", { path: "a" }]), { seq: seq++, type: "user_input", content: "next" }])).toBe("phase:turn");
	});
	it("reading on after reading is mid-phase — no end", () => {
		expect(detect([...round(["read_file", { path: "a" }]), ...round(["search_text", { query: "x" }])])).toBeNull();
	});
});

describe("A4(c) — a prune pays only if enough requests follow", () => {
	it("the factor comes from the price table: 49 at 0.15 / 0.003", () => {
		expect(breakEvenFactor(0.15, 0.003)).toBeCloseTo(49, 6);
		expect(breakEvenFactor(undefined, undefined)).toBe(49);
	});
	it("dropping 60k and re-sending 180k cold needs 147 requests", () => {
		expect(pruneBreaksEven(60_000, 180_000, 49, 150)).toBe(true);
		expect(pruneBreaksEven(60_000, 180_000, 49, 26)).toBe(false);
	});
	it("the guarded prune refuses when too few requests remain", () => {
		let seq = 0;
		const events: unknown[] = [];
		for (let i = 0; i < 8; i++) {
			events.push({ seq: seq++, type: "tool_call_end", callId: `r${i}`, name: "read_file", input: { path: `f${i}` } });
			events.push({ seq: seq++, type: "tool_result", callId: `r${i}`, content: "x".repeat(4_000), isError: false });
		}
		expect(guardedPruneSeq(events as never, 49, 1_000)).toBeDefined();
		expect(guardedPruneSeq(events as never, 49, 1)).toBeUndefined();
	});
});

// ── the session: the compaction point in a real run ────────────────────

const VALID_SUMMARY = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "none", "## Current work", "w", "## Next steps", "n"].join("\n");
const BIG = "line of source text\n".repeat(2_000); // 40k chars, ~10k tokens

const readFile = defineTool({
	name: "read_file",
	description: "read",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	execute: async () => ({ content: BIG, isError: false }),
});
const shell = defineTool({
	name: "shell",
	description: "shell",
	parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
	execute: async () => ({ content: "ok", isError: false }),
});

/** Five settled read rounds of ~10k tokens each, inside one user turn. */
async function seed(store: SessionStore): Promise<void> {
	let seq = 0;
	await store.append("s", "r1", { seq: seq++, type: "user_input", content: "work through the repo" });
	for (let i = 0; i < 5; i++) {
		await store.append("s", "r1", { seq: seq++, type: "tool_call_end", callId: `s${i}`, name: "read_file", input: { path: `f${i}.ts` } });
		await store.append("s", "r1", { seq: seq++, type: "stop", reason: "tool_use" });
		await store.append("s", "r1", { seq: seq++, type: "tool_result", callId: `s${i}`, content: BIG, isError: false });
	}
	await store.append("s", "r1", { seq: seq++, type: "text_delta", text: "read them all" });
	await store.append("s", "r1", { seq: seq++, type: "stop", reason: "end_turn" });
	await store.append("s", "r1", { seq: seq++, type: "terminal", outcome: { kind: "completed" } });
}

const usage = (inputTokens: number) => ({ type: "usage" as const, inputTokens, outputTokens: 200, cacheRead: inputTokens - 100, cacheWrite: null, known: true });
const call = (callId: string, name: string, input: Record<string, unknown>, billed: number) => ({
	events: [{ type: "tool_call_end" as const, callId, name, input }, usage(billed), { type: "stop" as const, reason: "tool_use" as const }],
});
const say = (text: string) => ({ events: [{ type: "text_delta" as const, text }, { type: "stop" as const, reason: "end_turn" as const }] });

/** Records every request the session sends — the summary calls included. */
function recording(script: FauxScript): { adapter: Adapter; requests: StreamOptions[] } {
	const faux = createFauxProvider(script);
	const requests: StreamOptions[] = [];
	return { adapter: { stream: (opts: StreamOptions) => (requests.push(opts), faux.stream(opts)) } as Adapter, requests };
}

async function runWith(script: FauxScript, prompt = "continue") {
	const dir = mkdtempSync(join(tmpdir(), "kiso-a1b-"));
	const store = new SessionStore(dir);
	await seed(store);
	const { adapter, requests } = recording(script);
	const agent = createAgent({ model: "faux", store, tools: [readFile, shell], adapter, systemPrompt: "you are a test agent", contextPolicy: { tiers: { windowTokens: 200_000 } } });
	const session = await agent.session({ id: "s" });
	for await (const _ of session.run(prompt)) {
		// the run lands in the log and the store
	}
	const ledger = (() => {
		try {
			return readFileSync(join(dir, "traces", "s.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
		} catch {
			return [];
		}
	})();
	return { store, requests, ledger, events: store.load("s").map((r) => r.event) };
}

const summaries = (ledger: Record<string, unknown>[]) => ledger.filter((l) => l.kind === "summary");

describe("A1b in a run — the hard tier, in-band", () => {
	it("over hard at a settled round: ONE summary mid-run, in-band on the run's own prefix, then the run goes on", async () => {
		const { requests, ledger, events } = await runWith([call("c1", "read_file", { path: "x.ts" }, 155_000), say(VALID_SUMMARY), say("done")]);
		expect(events.filter((e) => e.type === "summarized")).toHaveLength(1);
		expect(summaries(ledger)).toEqual([expect.objectContaining({ reason: "hard", path: "in-band" })]);
		// the summary call is request #2: the run's system prompt and tool
		// table, request #1's messages as a PREFIX, and the instruction last
		const [first, summary] = requests;
		expect(summary!.systemPrompt).toBe(first!.systemPrompt);
		expect(JSON.stringify(summary!.tools)).toBe(JSON.stringify(first!.tools));
		expect(JSON.stringify(summary!.messages.slice(0, first!.messages.length))).toBe(JSON.stringify(first!.messages));
		const last = summary!.messages.at(-1) as Message;
		expect(last.role === "user" && last.content).toBe(SUMMARY_IN_BAND);
		// the projection after it is well-formed: the summary opens, and
		// every tool call is followed by its own result
		const projected = projectMessages(events);
		expect(projected[0]!.role).toBe("user");
		for (let i = 0; i < projected.length; i++) {
			const m = projected[i]!;
			if (m.role !== "assistant") continue;
			const ids = m.blocks.filter((b) => b.type === "tool_use").map((b) => (b as { callId: string }).callId);
			ids.forEach((id, k) => expect((projected[i + 1 + k] as { callId?: string }).callId).toBe(id));
		}
		expect(events.some((e) => e.type === "terminal" && (e.outcome as { kind: string }).kind === "completed")).toBe(true);
	});
});

describe("A1b in a run — soft waits for a phase end", () => {
	it("over soft mid-phase: nothing; the next round runs the checks: it fires, and says why", async () => {
		const { events, ledger } = await runWith([
			call("c1", "read_file", { path: "x.ts" }, 140_000), // reads after reads — mid-phase
			call("c2", "shell", { command: "npm test" }, 141_000), // a check — the phase ends here
			say(VALID_SUMMARY),
			say("done"),
		]);
		expect(summaries(ledger)).toEqual([expect.objectContaining({ reason: "phase:check", path: "in-band" })]);
		const shellResult = events.findIndex((e) => e.type === "tool_result" && e.callId === "c2");
		const summarized = events.findIndex((e) => e.type === "summarized");
		expect(summarized).toBeGreaterThan(shellResult);
	});
});

describe("A1b in a run — the E6 guard and its one fallback", () => {
	it("an in-band reply that calls a tool is rejected; the serialised form runs once and its checkpoint lands", async () => {
		const { requests, ledger, events } = await runWith([
			call("c1", "read_file", { path: "x.ts" }, 155_000),
			{ events: [{ type: "tool_call_end", callId: "bad", name: "read_file", input: { path: "y" } }, { type: "stop", reason: "tool_use" }] },
			say(VALID_SUMMARY),
			say("done"),
		]);
		expect(events.filter((e) => e.type === "summarized")).toHaveLength(1);
		expect(summaries(ledger)).toEqual([expect.objectContaining({ reason: "hard", path: "serialized" })]);
		expect(requests[2]!.systemPrompt).toBe(SUMMARY_PROMPT);
	});
});

describe("A1b in a run — overflow recovers once", () => {
	it("the provider refuses the context: one summary, one retry, the run completes", async () => {
		const { events, ledger } = await runWith([
			{ events: [{ type: "fail", code: "context_overflow", status: 400, retryable: false, message: "maximum context length exceeded" }] },
			say(VALID_SUMMARY),
			say("done"),
		]);
		expect(summaries(ledger)).toEqual([expect.objectContaining({ reason: "overflow" })]);
		expect(events.some((e) => e.type === "terminal" && (e.outcome as { kind: string }).kind === "completed")).toBe(true);
	});
});
