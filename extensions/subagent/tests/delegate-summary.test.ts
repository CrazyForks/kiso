/**
 * 0.40.0 — the delegate's settled row says how many tasks ran and, when
 * some failed, WHY: a timeout, a failed acceptance check, or an error.
 * "1 failed" alone did not say whether to raise a timeout, fix the work,
 * or read a crash.
 *
 * The marker is the tool result's first line — machine-readable, rendered
 * verbatim by the TUI's settled row — so its shape is pinned here.
 */
import { describe, expect, it } from "vitest";
import { delegateSummary, failKindOf } from "../dist/kiso-subagent.mjs";

const ok = { failed: false, toolCalls: 4 };
const fail = (failKind: "timeout" | "acceptance" | "error") => ({ failed: true, failKind, toolCalls: 1 });

describe("0.40.0 — failKindOf", () => {
	it("a timeout is a timeout, whatever else is true", () => {
		expect(failKindOf("timeout", { skipped: "timeout" })).toBe("timeout");
	});
	it("an acceptance check that RAN and failed is acceptance", () => {
		expect(failKindOf("completed", { passed: false })).toBe("acceptance");
	});
	it("everything else is an error: a crash, an abort, a missing result, a spawn failure", () => {
		for (const status of ["killed", "spawn-failed", "missing", "no-terminal", "ambiguous", "completed"]) expect(failKindOf(status, null)).toBe("error");
		expect(failKindOf("killed", { skipped: "killed" })).toBe("error");
	});
});

describe("0.40.0 — delegateSummary", () => {
	it("nothing failed: the task count leads, no parenthesis", () => {
		expect(delegateSummary([ok, ok, ok], 2)).toBe("summary: 3 tasks · 12 tool calls · 2 roles · 0 failed");
	});
	it("one task: singular words", () => {
		expect(delegateSummary([ok], 1)).toBe("summary: 1 task · 4 tool calls · 1 role · 0 failed");
	});
	it("failures name their kinds, in a fixed order, zero counts omitted", () => {
		expect(delegateSummary([ok, fail("acceptance"), fail("timeout")], 2)).toBe("summary: 3 tasks · 6 tool calls · 2 roles · 2 failed (1 timeout, 1 acceptance)");
		expect(delegateSummary([fail("error"), fail("error")], 1)).toBe("summary: 2 tasks · 2 tool calls · 1 role · 2 failed (2 error)");
	});
	it("a failed section with no kind (an older shape) counts as an error — never silently uncounted", () => {
		expect(delegateSummary([{ failed: true, toolCalls: 0 }], 1)).toBe("summary: 1 task · 0 tool calls · 1 role · 1 failed (1 error)");
	});
});
