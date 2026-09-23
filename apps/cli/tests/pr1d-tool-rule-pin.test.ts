import { describe, expect, it } from "vitest";
import { composeToolTable } from "@vincemakes/kiso-runtime/internal";
import { CODING_TOOL_RULES } from "../src/coding-prompt.js";

/**
 * PR-1d: a CONTENT-PRESENCE REGRESSION GUARD for the tool table's shell row.
 *
 * The row it replaced — "reserve shell for real system commands" — is the
 * text PR-1's weather cell traced its 0/5 to. **That does not make this row
 * necessary**, and the first draft of this comment said it did. The round
 * measured a COMBINATION: PR-1's arm A carried the tool texts alone and
 * scored 1/5, which shows they are not sufficient. Nothing isolates this row.
 *
 * R1 (2026-09-23): the row moved from the runtime's constant to the CLI's
 * CODING_TOOL_RULES, so the guard moved with it — the content is the
 * product's now, and the runtime has nothing to pin.
 *
 * A regex cannot guarantee meaning: a negation can preserve every match below
 * and reverse the instruction. This catches deletion and gross rewording.
 */
describe("PR-1d: the tool table's shell row", () => {
	const registry = { list: () => [{ name: "shell" }] } as unknown as Parameters<typeof composeToolTable>[0];

	it("reaches beyond the file tools, and names the network", () => {
		const table = composeToolTable(registry, CODING_TOOL_RULES);
		expect(table).toMatch(/shell for what the file tools cannot do/i);
		expect(table).toMatch(/the network/i);
	});

	it("no longer narrows shell to 'real system commands'", () => {
		expect(composeToolTable(registry, CODING_TOOL_RULES)).not.toMatch(/reserve shell for real system commands/i);
	});
});
