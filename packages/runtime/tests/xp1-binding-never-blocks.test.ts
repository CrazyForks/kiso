/**
 * XP-1 — a CHANGED BINDING never blocks (the owner's ruling of 2026-09-21).
 *
 * The rule before it: `material` drift refused the open unless the caller
 * passed `acceptDrift`, so "I moved to another provider" was an error a
 * resume could not pass at all — and DC-8's grandfather case (an unscoped
 * record meeting a scoped process) drifted on every session recorded
 * before the scope existed.
 *
 * The rule now: the CURRENT configuration wins, DURABLY — the next
 * revision records what will answer the next request — and the session
 * says what changed through `driftAcknowledgement`. Nothing
 * provider-specific crosses the change: every adapter withholds foreign
 * reasoning/continuation (MG-1 A5), so a new binding loses cache state,
 * never correctness.
 *
 * The fail-closed INTEGRITY cases are untouched, and pinned here as the
 * boundary: a sidecar that cannot be read is still BLOCKED, and an XP-era
 * log (scoped envelopes, no sidecar) is still BLOCKED. A ruling about
 * bindings must never become a ruling about integrity.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Adapter } from "@vincemakes/kiso-core";
import { ToolRegistry } from "@vincemakes/kiso-core";
import { createAgent, SessionStore } from "../src/index.js";
import { buildProfile, profilePath, readProfile, writeProfile } from "../src/profile.js";

const DONE: Adapter = {
	stream: async function* () {
		yield { seq: 0, type: "text_delta", text: "ok" } as never;
		yield { seq: 0, type: "stop", reason: "end_turn" } as never;
	},
};

function freshDir(): string {
	return mkdtempSync(join(tmpdir(), "kiso-bind-"));
}

/** A one-turn legacy log: the resume has something to continue. */
async function loggedSession(id: string, dir: string): Promise<void> {
	const store = new SessionStore(dir);
	await store.append(id, "r1", { seq: 0, type: "user_input", content: "hi" } as never);
	await store.append(id, "r1", { seq: 1, type: "stop", reason: "end_turn" } as never);
	store.closeAll();
}

describe("XP-1 — the recorded binding is history, never a gate", () => {
	it("an UNSCOPED record meeting a scoped process opens (DC-8's grandfather case)", async () => {
		const dir = freshDir();
		await loggedSession("g1", dir);
		writeProfile(dir, "g1", buildProfile({ revision: 4, modelId: "legacy-x", provider: null, registry: new ToolRegistry() }));
		const agent = createAgent({
			model: "deepseek-v4-flash",
			provider: "openai-compat",
			baseUrl: "https://api.deepseek.com",
			store: new SessionStore(dir),
			tools: [],
			adapter: DONE,
		});
		// RED pre-patch: this open threw /accept-drift/ — every pre-0.16.0
		// session met the new scope this way.
		const session = await agent.session({ id: "g1" });
		expect(session.model, "the current configuration runs").toBe("deepseek-v4-flash");
		const meta = readProfile(dir, "g1");
		expect(meta.kind, "the change is durable history").toBe("ok");
		if (meta.kind === "ok") {
			expect(meta.profile.revision).toBe(5);
			expect(meta.profile.provider?.providerId, "what will answer the next request").toBe("deepseek");
		}
		expect(session.driftAcknowledgement?.reasons[0], "and the session names what changed").toMatch(/unscoped/);
	});

	it("a SWITCHED provider opens under the current configuration — the model the person asked for", async () => {
		const dir = freshDir();
		await loggedSession("g2", dir);
		writeProfile(
			dir,
			"g2",
			buildProfile({
				revision: 2,
				modelId: "deepseek-flash",
				provider: { providerId: "deepseek", apiId: "openai-chat", modelId: "deepseek-flash" },
				registry: new ToolRegistry(),
			}),
		);
		const agent = createAgent({
			model: "deepseek/deepseek-v4-flash",
			provider: "openai-compat",
			baseUrl: "https://api.commandcode.ai/provider/v1",
			store: new SessionStore(dir),
			tools: [],
			adapter: DONE,
		});
		const session = await agent.session({ id: "g2" });
		expect(session.model, "the current configuration runs — not the recorded model").toBe("deepseek/deepseek-v4-flash");
		const meta = readProfile(dir, "g2");
		expect(meta.kind === "ok" && meta.profile.revision).toBe(3);
		expect(meta.kind === "ok" && meta.profile.provider?.providerId).toBe("custom");
		expect(session.driftAcknowledgement?.reasons[0]).toMatch(/deepseek/);
	});

	it("the INTEGRITY cases are still BLOCKED — a binding ruling is not an integrity ruling", async () => {
		// an unreadable sidecar: never read as absent, never rebuilt
		const a = freshDir();
		await loggedSession("g3", a);
		writeFileSync(profilePath(a, "g3"), "{ this is not json");
		await expect(
			createAgent({ model: "faux-y", store: new SessionStore(a), tools: [], adapter: DONE }).session({ id: "g3" }),
		).rejects.toThrow(/unreadable/i);

		// an XP-era log — scoped envelopes and no sidecar
		const b = freshDir();
		const store = new SessionStore(b);
		await store.append("g4", "r1", { seq: 0, type: "user_input", content: "go" } as never);
		await store.append("g4", "r1", {
			seq: 1,
			type: "stop",
			reason: "end_turn",
			continuation: { scope: { providerId: "anthropic", apiId: "anthropic-messages", modelId: "m" }, entries: [] },
		} as never);
		store.closeAll();
		await expect(
			createAgent({ model: "faux-y", store: new SessionStore(b), tools: [], adapter: DONE }).session({ id: "g4" }),
		).rejects.toThrow(/integrity|missing/i);
	});
});
