/**
 * ACI-6 — the routing policy is stated ONCE.
 *
 * It was stated three times and two of them disagreed: the base prompt
 * said "shell is for commands: builds, tests, git, GREP" while
 * `TOOL_RULES` said "search with search_text, NEVER shell grep/rg". The
 * batching directive was carried verbatim in both. And one line above the
 * batching bullet the prompt said "run one command at a time", which reads
 * as its opposite.
 *
 * `TOOL_RULES` is canonical because it is composed from the ACTIVE
 * registry: it names only tools that exist, one line each, deterministic.
 * The base prompt's copy is static, cannot know which tools are active,
 * and is the copy that drifted.
 *
 * WHAT IS DELETED AND WHY NOTHING IS ADDED. This programme measured a
 * +35% cost regression from a prompt round, traced to REASONING tokens
 * rather than prompt bytes, and recorded that reasoning length depends on
 * WHICH text is present. Deletion is the lowest-exposure class of prompt
 * change, so the fix is deletions only.
 *
 * "Run one command at a time" goes because the KERNEL already guarantees
 * it: a tool that declares no `effects` is EXCLUSIVE and the kernel
 * serialises it behind a FIFO barrier installed at call order
 * (`loop.ts`). `shell` declares none. So batched shell calls already run
 * one at a time, enforced, and the sentence was costing a model round
 * trip per command to restate a machine invariant.
 */

import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/index.js";
import { composeToolTable } from "@vincemakes/kiso-runtime/internal";
import { createCodingTools } from "@vincemakes/kiso-tools-node";

const table = (): string => {
	const tools = createCodingTools({ workspaceRoot: "/tmp" });
	return composeToolTable({ list: () => tools } as never);
};

describe("ACI-6: the routing policy is stated once", () => {
	it("the base prompt no longer routes grep to shell", () => {
		expect(SYSTEM_PROMPT).not.toMatch(/shell is for commands[\s\S]{0,40}grep/i);
	});

	it("and TOOL_RULES still says never — the canonical copy is unchanged", () => {
		expect(table()).toMatch(/search with search_text, never shell grep\/rg/i);
	});

	it("the batching directive appears EXACTLY ONCE across prompt and table", () => {
		const both = `${SYSTEM_PROMPT}\n${table()}`;
		const hits = both.match(/batch independent tool calls/gi) ?? [];
		expect(hits, `found ${hits.length}`).toHaveLength(1);
	});

	it("the shell CAUTION survives — it is not duplicated and not what contradicted", () => {
		expect(SYSTEM_PROMPT).toMatch(/side effects/i);
		expect(SYSTEM_PROMPT).toMatch(/may take time/i);
	});

	it("'one command at a time' is gone — the kernel enforces it, the prompt was paying for it", () => {
		expect(SYSTEM_PROMPT).not.toMatch(/one command at a time/i);
	});

	// The kernel invariant the deletion relies on. If this ever goes red the
	// deletion loses its justification, so it is asserted here rather than
	// left as a claim in a commit message.
	it("shell declares no concurrency, so the kernel serialises it", async () => {
		const { createCodingTools: make } = await import("@vincemakes/kiso-tools-node");
		const shell = make({ workspaceRoot: "/tmp" }).find((t) => t.name === "shell");
		expect(shell, "shell is in the default set").toBeDefined();
		expect(shell!.effects?.concurrency).not.toBe("shared");
	});
});

describe("ACI-6: what this round must NOT touch", () => {
	// Regression guards, GREEN before this change too. Their job is to stay
	// green while the deletions above go red — they are not red proofs, and
	// calling them proofs would be the red-in-both-positions mistake.
	it("the reach section is byte-identical — it contradicts nothing AND it is one of the five clauses PR-1 measured together", () => {
		expect(SYSTEM_PROMPT).toContain("What you can reach:");
		expect(SYSTEM_PROMPT).toContain("- The workspace: read_file, list_dir, search_text, write_file, edit_file.");
		expect(SYSTEM_PROMPT).toMatch(/The human: ask_user, for a decision that is theirs\./);
	});

	it("the 0.37.0 re-read bullet is byte-identical — it was measured", () => {
		expect(SYSTEM_PROMPT).toContain(
			"- Do not re-read a file you already read unchanged, or one you changed\n  yourself through a confirmed edit — rely on the earlier result and\n  on the change you just made.",
		);
	});
});
