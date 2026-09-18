/**
 * One command list — what dispatch handles, `/help` names, and `/`
 * offers are the same set (0.39.2).
 *
 * Three hand-kept lists of the slash commands, and they had drifted in
 * both directions a person can fall into:
 *  - `/context` was dispatchable and not in `/help`, so the only way to
 *    learn it existed was to read the source (fixed in 0.39.1);
 *  - `/reload` and `/copy` were dispatchable and in `/help`, and typing
 *    `/` never offered them — the completion menu is where someone who
 *    does not know a command exists goes to find one.
 *
 * Nothing went red, because a missing row is not an error; the command
 * still works for anyone who already knows its name. That is the whole
 * problem, and it is why this is a property of the three sources read
 * together rather than a test of any one of them.
 *
 * Sources are READ, not imported: this is a repo gate, and the dispatcher
 * has no list to import — its commands exist only as the comparisons it
 * makes. A comparison is exactly what a person's keystroke has to match,
 * so that is the right place to take the truth from.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

/** What dispatch actually matches: `trimmed === "/x"`. The commands that
 *  take an argument also match `startsWith("/x ")`, and always alongside
 *  the bare form, so the bare form is the complete set. */
const dispatched = new Set([...read("apps/cli/src/dispatch.ts").matchAll(/trimmed === "(\/[a-z]+)"/g)].map((m) => m[1]!));
/** `/help`'s rows — the HELP_TABLE entries whose name is a slash command. */
const helped = new Set([...read("packages/tui-cells/src/strings.ts").matchAll(/^\t\["(\/[a-z]+)",/gm)].map((m) => m[1]!));
/** What typing `/` offers. */
const offered = new Set([...read("packages/tui/src/editor.ts").matchAll(/\{ name: "(\/[a-z]+)",/g)].map((m) => m[1]!));

const minus = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => !b.has(x)).sort();

describe("one command list", () => {
	it("each source was actually read — an empty read is a failed read, not an empty list", () => {
		expect(dispatched.size).toBeGreaterThan(8);
		expect(helped.size).toBeGreaterThan(8);
		expect(offered.size).toBeGreaterThan(8);
		expect(dispatched.has("/compact") && helped.has("/compact") && offered.has("/compact")).toBe(true);
	});

	it("every command dispatch handles is named by /help", () => {
		expect(minus(dispatched, helped), "dispatchable, and /help never mentions it").toEqual([]);
	});

	it("every command dispatch handles is offered by the / menu", () => {
		expect(minus(dispatched, offered), "dispatchable, and typing / never offers it").toEqual([]);
	});

	it("nothing is listed that dispatch does not handle — a row for a command that does nothing is worse than no row", () => {
		expect(minus(helped, dispatched), "in /help, not dispatchable").toEqual([]);
		expect(minus(offered, dispatched), "in the / menu, not dispatchable").toEqual([]);
	});
});
