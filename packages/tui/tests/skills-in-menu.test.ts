/**
 * 0.40.1 (owner's ruling, revoking the 0.41.0 deferral) — installed skills
 * appear in the `/` completion menu as `/<name>`, by prefix, after the
 * built-in commands. A built-in always wins a shared name: a skill named
 * like a command is never listed twice and never shadows it.
 */
import { describe, expect, it } from "vitest";
import { Editor, MENU_ITEMS } from "../src/editor.js";

const enc = (s: string) => new TextEncoder().encode(s);
const names = (e: Editor): string[] => (e.menuState()?.items ?? []).map((m) => m.name);

const SKILLS = [
	{ name: "/boss-call", desc: "mailbox between sessions · skill" },
	{ name: "/review", desc: "review a diff · skill" },
	{ name: "/help", desc: "a skill named like a built-in · skill" },
];

describe("0.40.1 — skills in the / menu", () => {
	it("`/b` offers the boss-call skill by prefix", () => {
		const e = new Editor(() => {});
		e.bindMenuExtras(() => SKILLS);
		e.feed(enc("/b"));
		expect(names(e)).toContain("/boss-call");
	});

	it("a bare `/` lists the built-ins first, then the skills", () => {
		const e = new Editor(() => {});
		e.bindMenuExtras(() => SKILLS);
		e.feed(enc("/"));
		const n = names(e);
		const firstSkill = n.indexOf("/boss-call");
		expect(firstSkill).toBeGreaterThan(-1);
		for (const b of MENU_ITEMS) expect(n.indexOf(b.name)).toBeLessThan(firstSkill);
	});

	it("a built-in wins a shared name — `/help` is listed once, as the command", () => {
		const e = new Editor(() => {});
		e.bindMenuExtras(() => SKILLS);
		e.feed(enc("/he"));
		const items = e.menuState()?.items ?? [];
		expect(items.filter((m) => m.name === "/help")).toHaveLength(1);
		expect(items.find((m) => m.name === "/help")?.desc).not.toContain("skill");
	});

	it("the source is read live — a skill installed later appears on the next keystroke", () => {
		const e = new Editor(() => {});
		let list: typeof SKILLS = [];
		e.bindMenuExtras(() => list);
		e.feed(enc("/re"));
		expect(names(e)).not.toContain("/review");
		list = SKILLS;
		e.feed(enc("v"));
		expect(names(e)).toContain("/review");
	});

	it("unbound, the menu is exactly the built-ins (nothing invented)", () => {
		const e = new Editor(() => {});
		e.feed(enc("/"));
		expect(names(e)).toEqual(MENU_ITEMS.map((m) => m.name));
	});
});
