/**
 * Two small head-row corrections, owner-requested.
 *
 * 1. `list_dir` with an EXPLICIT "." read as `list_dir .` on the row.
 *    `toolTargetRaw` already answered "(root)" for an ABSENT path — the
 *    intent was there and written in the comment — but a model that
 *    sends the dot explicitly means the same thing and got the dot. The
 *    fix is that "." and "./" are the same request as omitting it.
 *
 * 2. A QUEUED call showed `◦ verb target` and nothing said it had not
 *    started. The `◦` carries that alone, and a marker is not a word:
 *    on a screen where running and queued rows sit together, the reader
 *    has to know the glyph. A dim `· queued` says it.
 */

import { describe, expect, it } from "vitest";
import { toolTarget } from "../src/render.js";

describe("list_dir's target names the root", () => {
	it("an explicit '.' is the same request as omitting the path", () => {
		expect(toolTarget("list_dir", { path: "." })).toBe("(root)");
		expect(toolTarget("list_dir", { path: "./" })).toBe("(root)");
		expect(toolTarget("list_dir", {})).toBe("(root)"); // unchanged
	});

	it("a real path is untouched, including one that merely starts with a dot", () => {
		expect(toolTarget("list_dir", { path: "src" })).toBe("src");
		expect(toolTarget("list_dir", { path: "./src" })).toBe("./src");
		expect(toolTarget("list_dir", { path: ".github" })).toBe(".github");
		expect(toolTarget("list_dir", { path: ".." })).toBe("..");
	});

	it("no other tool gains a root label — read_file '.' is not a directory listing", () => {
		expect(toolTarget("read_file", { path: "." })).toBe(".");
	});
});
