/**
 * R3 — the hosted-session service, on the faux provider.
 *
 * Every behaviour here is one the two hosting products had to get right by
 * hand: the one-run rule, exact replay across a reconnect (including at the
 * seam, mid-run), the open-run refusal and `resumeFirst`, approvals routed
 * to a parked run and `needsResume` when nobody is live, abort refusing a
 * parked run unless forced, executing-tool accounting through drain.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineTool, type Event } from "@vincemakes/kiso-core";
import { createFauxProvider, type FauxScript } from "@vincemakes/kiso-evals";
import { createAgent, SessionStore } from "@vincemakes/kiso-runtime";
import { createSessionService, DrainingError, InFlightError, OpenRunError } from "../src/index.js";

const ONE_TURN: FauxScript = [{ events: [{ type: "text_delta", text: "hello" }, { type: "stop", reason: "end_turn" }] }];

/** A script that calls `name` once, then finishes. */
const callThen = (name: string, input: Record<string, unknown> = {}): FauxScript => [
	{ events: [{ type: "tool_call_end", callId: "c1", name, input }, { type: "stop", reason: "tool_use" }] },
	{ events: [{ type: "text_delta", text: "done" }, { type: "stop", reason: "end_turn" }] },
];

/** A tool whose execution the test releases by hand. */
function gatedTool(name: string) {
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const tool = defineTool({
		name,
		description: `${name} — waits for the test`,
		parameters: { type: "object" },
		execute: async () => {
			await gate;
			return { content: "ok", isError: false };
		},
	});
	return { tool, release: () => release() };
}

const instant = (name: string) =>
	defineTool({
		name,
		description: name,
		parameters: { type: "object" },
		execute: async () => ({ content: "ok", isError: false }),
	});

function harness(opts: { script?: FauxScript; tools?: ReturnType<typeof instant>[]; defer?: string[]; parkedBy?: () => string[] } = {}) {
	const store = new SessionStore(mkdtempSync(join(tmpdir(), "kiso-server-")));
	let opened = 0;
	const service = createSessionService({
		store,
		open: async () => {
			opened += 1;
			return createAgent({
				model: "faux",
				store,
				tools: opts.tools ?? [],
				adapter: createFauxProvider(opts.script ?? ONE_TURN),
				...(opts.defer !== undefined ? { permissionPolicy: { rules: opts.defer.map((tool) => ({ tool, action: "defer" as const })) } } : {}),
			});
		},
		...(opts.parkedBy !== undefined ? { hooks: { parkedBy: opts.parkedBy } } : {}),
	});
	return { store, service, opened: () => opened };
}

/** Resolves once an event of `type` has been delivered for the session —
 *  already on disk, or the next one the live run emits. */
async function awaitEvent(service: ReturnType<typeof createSessionService>, sessionId: string, type: Event["type"]): Promise<void> {
	if (service.events(sessionId).some((e) => e.type === type)) return;
	await new Promise<void>((resolve) => {
		let off: (() => void) | null = null;
		void service.subscribe(sessionId, -1, (e) => {
			if (e.type !== type) return;
			resolve();
			queueMicrotask(() => off?.());
		}).then((unsubscribe) => {
			off = unsubscribe;
		});
	});
}

describe("the registry and the one-run rule", () => {
	it("opens a session once for concurrent callers, and a second run while one is live is InFlightError", async () => {
		const { tool, release } = gatedTool("slow");
		const { service, opened } = harness({ script: callThen("slow"), tools: [tool] });
		const [a, b] = await Promise.all([service.subscribe("s", -1, () => {}), service.subscribe("s", -1, () => {})]);
		expect(opened()).toBe(1);
		const first = await service.run("s", "go");
		await awaitEvent(service, "s", "tool_execution_started");
		expect(service.isRunning("s")).toBe(true);
		await expect(service.run("s", "again")).rejects.toBeInstanceOf(InFlightError);
		release();
		await first.done;
		expect(service.isRunning("s")).toBe(false);
		a();
		b();
	});
});

describe("replay from a sequence number", () => {
	it("a reconnecting subscriber receives every event after its last seq exactly once, including across the seam of a live run", async () => {
		const { tool, release } = gatedTool("slow");
		const { service } = harness({ script: callThen("slow"), tools: [tool] });
		const first: Event[] = [];
		const off = await service.subscribe("s", -1, (e) => first.push(e));
		const handle = await service.run("s", "go");
		await awaitEvent(service, "s", "tool_execution_started"); // the run is inside the tool now
		off(); // the client drops mid-run
		const lastSeen = first.at(-1)!.seq;
		const second: Event[] = [];
		// reconnect while the run is still live: replay covers the disk, the
		// listener covers what lands from now on, nothing twice at the seam
		const off2 = await service.subscribe("s", lastSeen, (e) => second.push(e));
		release();
		await handle.done;
		off2();
		const all = service.events("s");
		const seqs = (xs: readonly Event[]) => xs.map((e) => e.seq);
		expect(seqs([...first, ...second])).toEqual(seqs(all));
		expect(new Set(seqs(second)).size).toBe(second.length); // no duplicate
		expect(second[0]!.seq).toBe(lastSeen + 1);
		expect(all.at(-1)!.type).toBe("terminal");
		expect(service.highWater("s")).toBe(all.at(-1)!.seq);
	});

	it("events(after) is a plain read of the log and opens nothing", async () => {
		const { service, opened } = harness();
		expect(service.events("never-opened")).toEqual([]);
		expect(opened()).toBe(0);
	});
});

describe("an open run left by a previous process", () => {
	it("run() refuses with OpenRunError naming the run; resumeFirst drives it to its terminal, then runs the new turn", async () => {
		const { store, service } = harness({ script: ONE_TURN });
		// a log with a run that never terminated — what a crash leaves behind
		await store.append("s", "r-dead", { seq: 0, type: "user_input", content: "before the crash" });
		expect(service.openRuns()).toEqual([{ sessionId: "s", runId: "r-dead" }]);
		const err = await service.run("s", "next").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(OpenRunError);
		expect((err as OpenRunError).runId).toBe("r-dead");
		const handle = await service.run("s", "next", { resumeFirst: true });
		await handle.done;
		const terminals = service.events("s").filter((e) => e.type === "terminal");
		expect(terminals).toHaveLength(2); // the dead run's, then the new turn's
		expect(service.openRuns()).toEqual([]);
	});
});

describe("approvals and abort", () => {
	it("a deferred tool parks the run; abort refuses (parked), approve continues, needsResume is false while live", async () => {
		const { service } = harness({ script: callThen("deploy", { env: "prod" }), tools: [instant("deploy")], defer: ["deploy"] });
		const seen: Event[] = [];
		await service.subscribe("s", -1, (e) => seen.push(e));
		const handle = await service.run("s", "ship it");
		await awaitEvent(service, "s", "permission_requested");
		const pending = await service.pendingApprovals("s");
		expect(pending).toHaveLength(1);
		const parked = await service.abort("s");
		expect(parked.kind).toBe("parked");
		expect(parked.kind === "parked" && parked.approvals[0]!.name).toBe("deploy");
		expect(service.isRunning("s")).toBe(true); // nothing was voided
		const { needsResume } = await service.approve("s", pending[0]!.decisionId, true, "release window");
		expect(needsResume).toBe(false);
		await handle.done;
		expect(seen.some((e) => e.type === "tool_execution_succeeded")).toBe(true);
		expect(seen.at(-1)).toMatchObject({ type: "terminal", outcome: { kind: "completed" } });
		expect(await service.abort("s")).toEqual({ kind: "idle" });
	});

	it("force aborts a parked run: the terminal is aborted, the hook runs, and the outcome is stopped", async () => {
		const { service } = harness({ script: callThen("deploy"), tools: [instant("deploy")], defer: ["deploy"] });
		const handle = await service.run("s", "ship it");
		await awaitEvent(service, "s", "permission_requested");
		const outcome = await service.abort("s", { force: true });
		expect(outcome.kind).toBe("stopped");
		await handle.done;
		expect(service.events("s").at(-1)).toMatchObject({ type: "terminal", outcome: { kind: "aborted" } });
	});

	it("hooks.parkedBy parks a run the kernel would not, and onAbort runs after a forced abort", async () => {
		const { tool, release } = gatedTool("slow");
		const onAbort: string[] = [];
		const store = new SessionStore(mkdtempSync(join(tmpdir(), "kiso-server-")));
		const service = createSessionService({
			store,
			open: async () => createAgent({ model: "faux", store, tools: [tool], adapter: createFauxProvider(callThen("slow")) }),
			hooks: { parkedBy: () => ["a question is open"], onAbort: (id, runId) => void onAbort.push(`${id}:${runId}`) },
		});
		const handle = await service.run("s", "go");
		await awaitEvent(service, "s", "tool_execution_started");
		const parked = await service.abort("s");
		expect(parked).toMatchObject({ kind: "parked", reasons: ["a question is open"] });
		const stopped = await service.abort("s", { force: true });
		expect(stopped.kind).toBe("stopped");
		expect(onAbort).toEqual([`s:${handle.runId}`]); // the hook runs on the abort, not on the settle
		release(); // the gated tool ignores the abort; only its return lets the run settle
		await handle.done;
		if (stopped.kind === "stopped") await stopped.settled;
	});
});

describe("drain and close", () => {
	it("drain waits for an executing tool up to the grace and reports it; runs refuse while draining", async () => {
		const { tool, release } = gatedTool("slow");
		const { service } = harness({ script: callThen("slow"), tools: [tool] });
		const handle = await service.run("s", "go");
		await awaitEvent(service, "s", "tool_execution_started");
		expect(service.executingCount()).toBe(1);
		const timedOut = await service.drain(30);
		expect(timedOut).toEqual({ waitedFor: ["s"], parked: [], interrupted: [], timedOut: ["s"] });
		await expect(service.run("t", "x")).rejects.toBeInstanceOf(DrainingError);
		await expect(service.resume("s")).rejects.toBeInstanceOf(DrainingError);
		release();
		await handle.done;
		expect(service.executingCount()).toBe(0);
		const drained = await service.drain(30);
		expect(drained).toEqual({ waitedFor: [], parked: [], interrupted: [], timedOut: [] });
	});

	it("close aborts what is live and waits up to the grace for the terminal", async () => {
		const { tool, release } = gatedTool("slow");
		const { service } = harness({ script: callThen("slow"), tools: [tool] });
		const handle = await service.run("s", "go");
		await awaitEvent(service, "s", "tool_execution_started");
		const closing = service.close(5_000); // the grace covers the tool's return below
		release();
		await closing;
		await handle.done;
		expect(service.events("s").at(-1)).toMatchObject({ type: "terminal", outcome: { kind: "aborted" } });
	});
});

describe("reopen", () => {
	it("rebuilds an idle session from the factory, keeps its observers, and refuses while live", async () => {
		const { tool, release } = gatedTool("slow");
		const { service, opened } = harness({ script: callThen("slow"), tools: [tool] });
		const seen: Event[] = [];
		await service.subscribe("s", -1, (e) => seen.push(e));
		const handle = await service.run("s", "go");
		await awaitEvent(service, "s", "tool_execution_started");
		await expect(service.reopen("s")).rejects.toBeInstanceOf(InFlightError);
		release();
		await handle.done;
		const before = seen.length;
		await service.reopen("s");
		expect(opened()).toBe(2);
		const again = await service.run("s", "again", { resumeFirst: false });
		await again.done;
		expect(seen.length).toBeGreaterThan(before); // the carried listener saw the second run
	});
});
