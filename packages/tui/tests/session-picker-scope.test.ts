/**
 * 0.40.0 — the session picker opens on THIS workspace.
 *
 * A picker over every session ever run lists another project's work
 * beside this one's, newest first, and the one you meant is below the
 * fold. The scope is the recorded workspace (history — where the session
 * started), compared with the running one; `tab` flips to all; the title
 * always says which is showing and how many each holds; the text filter
 * runs inside the scope. A session with no recorded workspace is never
 * "here" — unknown history shows under ALL only, labelled.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "../src/editor.js";
import { scopeSessions, scopeTitle, sessionListFooter, sessionListHeader, sessionPickerRows, type SessionCardView } from "../src/session-picker.js";

const enc = (s: string) => new TextEncoder().encode(s);
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const NOW = 1_000_000_000_000;
const HERE = "/home/me/proj";

const card = (id: string, title: string, workspace: string | null | undefined, profileName: string | null = null): SessionCardView => ({
	id,
	title,
	badge: "completed",
	turns: 2,
	updatedAt: NOW - 3600_000,
	uncertain: 0,
	asks: 0,
	outcome: "completed",
	...(workspace !== undefined ? { workspace } : {}),
	profileName,
});

const CARDS: SessionCardView[] = [
	card("a", "fix the parser", HERE, "deep"),
	card("b", "draft the post", "/home/me/blog"),
	card("c", "tune the retry", HERE),
	card("d", "an old session", null),
];

let home: string | undefined;
beforeEach(() => {
	home = process.env.HOME;
	process.env.HOME = "/home/me";
	delete process.env.NO_COLOR;
});
afterEach(() => {
	if (home === undefined) delete process.env.HOME;
	else process.env.HOME = home;
});

describe("0.40.0 — the scope rule", () => {
	it("CURRENT is the sessions that started here; unknown history is never here", () => {
		const { cards, scope } = scopeSessions(CARDS, HERE, false);
		expect(cards.map((c) => c.id)).toEqual(["a", "c"]);
		expect(scope).toEqual({ here: HERE, all: false, inHere: 2, total: 4, fellBack: false });
	});

	it("ALL is every session", () => {
		const { cards, scope } = scopeSessions(CARDS, HERE, true);
		expect(cards.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
		expect(scope.all).toBe(true);
		expect(scope.fellBack).toBe(false);
	});

	it("nothing from here but sessions elsewhere: falls back to ALL, and says so — never an empty picker over a full store", () => {
		const { cards, scope } = scopeSessions(CARDS, "/somewhere/new", false);
		expect(cards).toHaveLength(4);
		expect(scope.fellBack).toBe(true);
		expect(scopeTitle(scope)).toBe("sessions · none from this workspace yet — all 4");
	});

	it("the title names the scope and both counts, and the key that flips it", () => {
		expect(scopeTitle(scopeSessions(CARDS, HERE, false).scope)).toBe("sessions · this workspace 2 of 4 · tab all");
		expect(scopeTitle(scopeSessions(CARDS, HERE, true).scope)).toBe("sessions · all 4 · tab this workspace (2)");
		expect(scopeTitle(null)).toBe("sessions");
	});
});

describe("0.40.0 — the rows under each scope", () => {
	it("CURRENT: rows carry the profile tag, and no workspace tag (every row is from here)", () => {
		const { cards, scope } = scopeSessions(CARDS, HERE, false);
		const rows = sessionPickerRows({ cards, matches: cards, selected: 0, scope }, 100, NOW).map(strip);
		expect(rows[0]).toContain("this workspace 2 of 4");
		expect(rows.find((r) => r.includes("fix the parser"))).toContain("· deep");
		expect(rows.join("\n")).not.toContain("~/proj");
	});

	it("ALL: a foreign row names where it came from (home as ~), an unknown one says so", () => {
		const { cards, scope } = scopeSessions(CARDS, HERE, true);
		const rows = sessionPickerRows({ cards, matches: cards, selected: 0, scope }, 100, NOW).map(strip);
		expect(rows.find((r) => r.includes("draft the post"))).toContain("· ~/blog");
		expect(rows.find((r) => r.includes("an old session"))).toContain("· workspace unknown");
		expect(rows.find((r) => r.includes("tune the retry"))).not.toContain("~/");
	});

	it("a long foreign path gives way first: the age and turns stay, the path shortens to its last directory", () => {
		// found by the PTY leg: the tag rode inside the meta span, and a long
		// temp path took the age and the turn count off the row with it
		const long = card("e", "a far away task", "/private/var/folders/rr/ssmz3cxj5rv4xlp6dtdbmt800000gn/T/kiso-ws-pty-abc123/beta", "deep");
		const { cards, scope } = scopeSessions([...CARDS, long], HERE, true);
		const row = sessionPickerRows({ cards, matches: cards, selected: 0, scope }, 80, NOW)
			.map(strip)
			.find((r) => r.includes("a far away task"))!;
		expect(row).toContain("1h · 2 turns");
		expect(row).toContain("\u2026/beta");
		expect(row).not.toContain("/private/var");
	});

	it("a tag never cuts the note — the note is the row's action", () => {
		// found by the TTY listing gate: "workspace unknown" took the room of
		// "1 uncertain — needs your verdict" at 80 columns
		const urgent: SessionCardView = { ...card("u", "refactor the bench", null, "deep"), badge: "uncertain", uncertain: 1, outcome: null };
		const { cards, scope } = scopeSessions([urgent, ...CARDS], HERE, true);
		const row = sessionPickerRows({ cards, matches: cards, selected: 1, scope }, 80, NOW)
			.map(strip)
			.find((r) => r.includes("refactor the bench"))!;
		expect(row).toContain("needs your verdict");
	});

	it("an unscoped picker (no workspace passed) keeps today's header", () => {
		const rows = sessionPickerRows({ cards: CARDS, matches: CARDS, selected: 0 }, 80, NOW).map(strip);
		expect(rows[0]).toMatch(/^─{3} sessions ─+$/);
	});
});

describe("0.40.0 — the keys", () => {
	it("tab flips CURRENT ↔ ALL; the filter runs inside the scope", () => {
		const editor = new Editor(() => {});
		editor.beginPick(() => CARDS, () => {}, HERE);
		expect(editor.pickState()!.matches.map((c) => c.id)).toEqual(["a", "c"]);
		editor.feed(enc("\t"));
		expect(editor.pickState()!.matches.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
		editor.feed(enc("post"));
		expect(editor.pickState()!.matches.map((c) => c.id)).toEqual(["b"]);
		editor.feed(enc("\t"));
		// back in CURRENT the same query matches nothing from here — the filter never reaches past the scope
		expect(editor.pickState()!.matches).toEqual([]);
		expect(editor.pickState()!.scope?.all).toBe(false);
	});

	it("tab is not typed into the query", () => {
		const editor = new Editor(() => {});
		editor.beginPick(() => CARDS, () => {}, HERE);
		editor.feed(enc("\t\t"));
		expect(editor.pickState()!.matches.map((c) => c.id)).toEqual(["a", "c"]);
	});

	it("an unscoped picker has no scope and tab does not flip anything", () => {
		const editor = new Editor(() => {});
		editor.beginPick(() => CARDS, () => {});
		expect(editor.pickState()!.scope).toBeNull();
		expect(editor.pickState()!.matches).toHaveLength(4);
	});
});

describe("0.40.0 — `kiso sessions` header", () => {
	it("names the scope and both counts; the footer keeps today's words", () => {
		expect(strip(sessionListHeader(2, 4, false, 100))).toBe("2 of 4 sessions from this workspace \u00b7 --all lists every one");
		expect(strip(sessionListHeader(0, 4, false, 100))).toBe("0 of 4 sessions from this workspace \u00b7 --all lists every one");
		expect(strip(sessionListHeader(2, 4, true, 100))).toBe("all 4 sessions");
		expect(strip(sessionListFooter(4, 100))).toBe("4 sessions \u00b7 kiso resume picks interactively");
	});
});
