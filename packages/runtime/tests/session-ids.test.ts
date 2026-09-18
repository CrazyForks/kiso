/**
 * 0.40.0 dogfood — /resume waited seconds before its picker opened. Its
 * id check went through store.list(), which reads every log whole to title
 * it: 2,828 ms on the owner's 119 sessions (one of them 83 MB), where the
 * directory alone answers in about a millisecond. The ids never open a log.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFauxProvider } from "@vincemakes/kiso-evals";
import { createAgent, SessionStore } from "../src/index.js";

describe("the session ids come from the directory alone", () => {
	it("a log that would fail to read is still listed — ids() never opens it — and an empty log is skipped, as list() skips it", () => {
		const dir = mkdtempSync(join(tmpdir(), "kiso-ids-"));
		writeFileSync(join(dir, "b.jsonl"), "this is not a session record\n");
		writeFileSync(join(dir, "a.jsonl"), "also not a record\n");
		writeFileSync(join(dir, "empty.jsonl"), "");
		writeFileSync(join(dir, "a.meta.json"), "{}");
		expect(new SessionStore(dir).ids()).toEqual(["a", "b"]);
	});

	it("agent.sessionIds() answers from ids(), never from list() — so an unreadable log cannot slow or break it", () => {
		const dir = mkdtempSync(join(tmpdir(), "kiso-ids-agent-"));
		writeFileSync(join(dir, "x.jsonl"), "not a record\n");
		const store = new SessionStore(dir);
		const agent = createAgent({ model: "faux", store, tools: [], adapter: createFauxProvider([]) });
		expect(() => store.list()).toThrow();
		expect(agent.sessionIds()).toEqual(["x"]);
	});
});
