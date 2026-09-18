/**
 * 0.40.0 dogfood (item 2) — a card from the sidecar alone. The state the
 * row prints comes from the summary; a missing summary or an unreadable log
 * is SAID, never guessed and never looked up in the log.
 */
import { describe, expect, it } from "vitest";
import { cardFromListing, cardsFromListings } from "../src/session-cards.js";

const base = { mtime: 1000, workspace: "/w", profileName: "p" };
const summary = { title: "fix the parser", turns: 3, updatedAt: 2000, state: "completed", uncertain: 0, asks: 0, workspaceUnknown: false, source: "run" as const };

describe("0.40.0 dogfood — cards from sidecars", () => {
	it("the summary's state becomes the row's state", () => {
		expect(cardFromListing({ id: "a", ...base, summary })).toMatchObject({ title: "fix the parser", badge: "completed", turns: 3, updatedAt: 2000, workspace: "/w", profileName: "p" });
		expect(cardFromListing({ id: "a", ...base, summary: { ...summary, state: "open" } }).badge).toBe("interrupted");
		expect(cardFromListing({ id: "a", ...base, summary: { ...summary, state: "aborted" } })).toMatchObject({ badge: "failed", outcome: "aborted" });
		expect(cardFromListing({ id: "a", ...base, summary: { ...summary, uncertain: 1, state: "open" } }).badge).toBe("uncertain");
		expect(cardFromListing({ id: "a", ...base, summary: { ...summary, asks: 2, state: "open" } }).badge).toBe("ask");
	});
	it("no summary, or an unreadable log, is said — the id stands in for the title, turns unknown", () => {
		expect(cardFromListing({ id: "old", ...base, summary: null })).toMatchObject({ title: "old", badge: "unknown", turns: null, updatedAt: 1000, outcome: "no summary" });
		expect(cardFromListing({ id: "bad", ...base, summary: { ...summary, title: null, turns: null, state: null } })).toMatchObject({ title: "bad", badge: "unknown", outcome: "log unreadable" });
	});
	it("newest first", () => {
		const cards = cardsFromListings([
			{ id: "old", ...base, summary: { ...summary, updatedAt: 1 } },
			{ id: "new", ...base, summary: { ...summary, updatedAt: 9 } },
		]);
		expect(cards.map((c) => c.id)).toEqual(["new", "old"]);
	});
});
