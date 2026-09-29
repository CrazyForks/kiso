/**
 * ADR-0057 — Safe Admission, the runtime half: the Run's ephemeral ingress.
 *
 * `run.steer()` hands the run a person's input. It is held in memory and
 * served to the kernel's admission sites; what is pending at one site
 * becomes ONE user_input (a single line as itself, several as text blocks
 * in arrival order). The moment the run decides to end, the ingress seals:
 * `steer()` then throws RunClosedError, and input still pending is handed
 * back by `unadmitted()`. `retract()` takes back what has not landed.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { defineTool, type Adapter, type Event, type HookHost, type Message } from "@vincemakes/kiso-core";
import { createAgent, RunClosedError, SessionStore, type Run } from "../src/index.js";

const TOOL_TURN = { events: [{ type: "tool_call_end" as const, callId: "c1", name: "work", input: {} }, { type: "stop" as const, reason: "tool_use" as const }] };
const END = { events: [{ type: "text_delta" as const, text: "done" }, { type: "stop" as const, reason: "end_turn" as const }] };

/** A session whose one tool runs `during(run)` while it executes. */
async function setup(options: {
	script: FauxScript;
	during?: (run: Run) => void;
	hooks?: HookHost;
	maxTurns?: number;
}): Promise<{ start: (input: string) => Run; requests: Message[][] }> {
	const dir = mkdtempSync(join(tmpdir(), "kiso-safe-admission-"));
	const faux = createFauxProvider(options.script);
	const requests: Message[][] = [];
	const adapter: Adapter = {
		stream(o) {
			requests.push([...o.messages]);
			return faux.stream(o);
		},
	};
	let current: Run | undefined;
	const work = defineTool({
		name: "work",
		description: "W",
		parameters: { type: "object" },
		execute: async () => {
			options.during?.(current!);
			return { content: "worked", isError: false };
		},
	});
	const session = await createAgent({
		model: "faux",
		store: new SessionStore(dir),
		tools: [work],
		adapter,
		...(options.hooks !== undefined ? { hooks: options.hooks } : {}),
		...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
	}).session({ id: "s" });
	return {
		requests,
		start: (input: string) => {
			current = session.run(input);
			return current;
		},
	};
}

async function drain(run: Run): Promise<Event[]> {
	const events: Event[] = [];
	for await (const ev of run) events.push(ev);
	return events;
}
const inputs = (events: readonly Event[]) => events.filter((e): e is Event & { type: "user_input" } => e.type === "user_input");

describe("ADR-0057 — run.steer(): the ingress", () => {
	it("one steer lands as itself, a person's words, on the next request", async () => {
		const { start, requests } = await setup({ script: [TOOL_TURN, END], during: (run) => run.steer("only editor tests") });
		const events = await drain(start("go"));
		const landed = inputs(events).at(-1)!;
		expect(landed.content).toBe("only editor tests");
		expect(landed.source).toBe("user");
		expect(requests.at(-1)!.at(-1)).toMatchObject({ role: "user", content: "only editor tests" });
	});

	it("three steers before one site become ONE user_input with three text blocks, in order", async () => {
		const { start } = await setup({
			script: [TOOL_TURN, END],
			during: (run) => {
				run.steer("a");
				run.steer("b");
				run.steer("c");
			},
		});
		const events = await drain(start("go"));
		expect(inputs(events)).toHaveLength(2);
		expect(inputs(events)[1]!.content).toEqual([
			{ type: "text", text: "a" },
			{ type: "text", text: "b" },
			{ type: "text", text: "c" },
		]);
	});

	it("retract() takes back what has not landed", async () => {
		let taken: readonly unknown[] = [];
		const { start } = await setup({
			script: [TOOL_TURN, END],
			during: (run) => {
				run.steer("x");
				run.steer("y");
				taken = run.retract();
			},
		});
		const events = await drain(start("go"));
		expect(taken).toEqual(["x", "y"]);
		expect(inputs(events)).toHaveLength(1);
	});
});

describe("ADR-0057 — the seal", () => {
	it("after the terminal, steer() throws RunClosedError", async () => {
		const { start } = await setup({ script: [END] });
		const run = start("go");
		await drain(run);
		expect(() => run.steer("late")).toThrow(RunClosedError);
	});

	it("the ingress is sealed before onStop runs: a steer from inside onStop is refused", async () => {
		let refused: unknown;
		let run: Run | undefined;
		const { start } = await setup({
			script: [END],
			hooks: {
				onStop: async () => {
					try {
						run!.steer("during onStop");
					} catch (e) {
						refused = e;
					}
				},
			},
		});
		run = start("go");
		const events = await drain(run);
		expect(refused).toBeInstanceOf(RunClosedError);
		expect(inputs(events).map((e) => e.content)).not.toContain("during onStop");
		expect(run.unadmitted()).toEqual([]);
	});

	it("maxTurns wins: a steer pending at the limit is handed back, never admitted", async () => {
		const { start, requests } = await setup({ script: [TOOL_TURN, END], maxTurns: 1, during: (run) => run.steer("too late") });
		const run = start("go");
		const events = await drain(run);
		expect(requests).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({ type: "terminal", outcome: { kind: "max_turns" } });
		expect(inputs(events).map((e) => e.content)).not.toContain("too late");
		expect(run.unadmitted()).toEqual(["too late"]);
	});

	it("a run abandoned by its consumer seals too", async () => {
		const { start } = await setup({ script: [TOOL_TURN, END] });
		const run = start("go");
		for await (const ev of run) {
			if (ev.type === "user_input") break;
		}
		expect(() => run.steer("after the break")).toThrow(RunClosedError);
	});
});
