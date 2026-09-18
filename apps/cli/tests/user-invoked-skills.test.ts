/**
 * 0.40.0 — the routing rules for a person's skill line, without a
 * terminal: built-ins win a shared name, `/skill` is the explicit door,
 * every refusal is one line naming its reason, and the submitted turn is
 * the body then the args — with `via` carrying the line as typed.
 */
import { describe, expect, it } from "vitest";
import type { SkillsCatalog } from "@vincemakes/kiso-skills-ext";
import { nearest, resolveSkillLine, skillsRows } from "../src/skill-invoke.js";

const BODIES: Record<string, string> = { review: "Review the diff.", compact: "A skill named like a built-in.", internal: "Model only." };

const catalog: SkillsCatalog = {
	entries: [
		{ name: "compact", description: "shadowed by the built-in", dir: "compact", path: "/s/compact/SKILL.md", userInvocable: true },
		{ name: "internal", description: "for the model", dir: "internal", path: "/s/internal/SKILL.md", userInvocable: false },
		{ name: "review", description: "review code", dir: "review", path: "/s/review/SKILL.md", userInvocable: true },
		{ name: "huge", description: "too big", dir: "huge", path: "/s/huge/SKILL.md", userInvocable: true },
	],
	broken: [{ dir: "half", reason: "no description" }],
	body: (name) => (name === "huge" ? { error: "over the 32,768-character skill cap (40,000 characters)" } : { body: BODIES[name]! }),
};
const builtins = ["/help", "/compact", "/resume", "/skill", "/skills"];

describe("0.40.0 — resolveSkillLine", () => {
	it("`/skill <name> args` submits the body, a blank line, and the args exactly as typed", () => {
		expect(resolveSkillLine("/skill review src/a.ts  --strict", catalog, builtins)).toEqual({
			kind: "submit",
			content: "Review the diff.\n\nsrc/a.ts  --strict",
			via: { kind: "skill", name: "review", line: "/skill review src/a.ts  --strict" },
		});
	});

	it("no args: the body alone, no trailing blank line", () => {
		expect(resolveSkillLine("/review", catalog, builtins)).toEqual({
			kind: "submit",
			content: "Review the diff.",
			via: { kind: "skill", name: "review", line: "/review" },
		});
	});

	it("a built-in wins a shared name — `/compact` is never the skill; `/skill compact` still reaches it", () => {
		expect(resolveSkillLine("/compact", catalog, builtins)).toBeNull();
		expect(resolveSkillLine("/compact keep the auth details", catalog, builtins)).toBeNull();
		expect(resolveSkillLine("/skill compact", catalog, builtins)).toMatchObject({ kind: "submit", via: { name: "compact" } });
	});

	it("an unknown `/word` stays the dispatcher's unknown command; an unknown `/skill word` names the nearest skills", () => {
		expect(resolveSkillLine("/reviw", catalog, builtins)).toBeNull();
		expect(resolveSkillLine("/skill reviw", catalog, builtins)).toEqual({
			kind: "error",
			message: 'no skill named "reviw" — nearest: review (/skills lists them)',
		});
		expect(resolveSkillLine("/skill zzzzzz", catalog, builtins)).toEqual({ kind: "error", message: 'no skill named "zzzzzz" (/skills lists them)' });
	});

	it("each refusal is one line with its reason: broken, model-only, over the cap, no name", () => {
		expect(resolveSkillLine("/half", catalog, builtins)).toEqual({ kind: "error", message: 'skill "half" cannot load: no description' });
		expect(resolveSkillLine("/skill internal", catalog, builtins)).toEqual({
			kind: "error",
			message: 'skill "internal" is for the model only (user-invocable: false)',
		});
		expect(resolveSkillLine("/huge", catalog, builtins)).toEqual({
			kind: "error",
			message: 'skill "huge" cannot load: over the 32,768-character skill cap (40,000 characters)',
		});
		expect(resolveSkillLine("/skill", catalog, builtins)).toEqual({ kind: "error", message: "usage: /skill <name> [args…] — /skills lists them" });
		for (const line of ["/half", "/skill internal", "/huge", "/skill", "/skill reviw"]) {
			const r = resolveSkillLine(line, catalog, builtins);
			expect(r?.kind === "error" ? r.message : "").not.toContain("\n");
		}
	});

	it("`/skills` lists; a multi-line paste that begins with / is prose; no catalog means no skills", () => {
		expect(resolveSkillLine("/skills", catalog, builtins)).toEqual({ kind: "list" });
		// an argument is a one-line usage, never "unknown command: /skills"
		expect(resolveSkillLine("/skills review", catalog, builtins)).toEqual({ kind: "error", message: "usage: /skills (no arguments) — /skill <name> [args] runs one" });
		expect(resolveSkillLine("/review\nand more", catalog, builtins)).toBeNull();
		expect(resolveSkillLine("/review", null, builtins)).toBeNull();
		expect(resolveSkillLine("/skill review", null, builtins)).toEqual({ kind: "error", message: 'no skill named "review" (/skills lists them)' });
	});
});

describe("0.40.0 — /skills rows", () => {
	it("each real source directory is named ONCE, its skills under it; model-only tagged; broken with the loader's reason", () => {
		const rows = skillsRows(catalog, (dir) => (dir === "review" ? "~/proj/.kiso/skills" : "~/.kiso/skills"), "~/.kiso/skills");
		expect(rows).toEqual([
			"~/.kiso/skills",
			"  /compact — shadowed by the built-in",
			"  /internal — for the model (model only)",
			"  /huge — too big",
			"  half — cannot load: no description",
			"~/proj/.kiso/skills",
			"  /review — review code",
			"/<name> [args] or /skill <name> [args] runs one · a built-in command wins a shared name",
		]);
	});
	it("nothing installed says where a skill goes", () => {
		expect(skillsRows(null, (d) => d, "~/.kiso/skills")).toEqual(["no skills installed — add one as ~/.kiso/skills/<name>/SKILL.md"]);
	});
});

describe("0.40.0 — nearest", () => {
	it("prefix or within two edits, closest first, at most three", () => {
		expect(nearest("rev", ["review", "revert", "rebase", "zzz"])).toEqual(["revert", "review"]); // ties by name
		expect(nearest("reviwe", ["review", "preview"])).toEqual(["review"]); // preview is three edits away
		expect(nearest("q", ["alpha"])).toEqual([]);
	});
});
