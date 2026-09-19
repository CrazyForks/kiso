/**
 * The protected list and the credential store's writer name the SAME
 * file. state.ts spells the store's path itself (auth/credentials.ts is
 * not imported there); this holds the two together, so a move of the store
 * cannot leave the protection guarding the old name.
 *
 * A TEMP KISO_HOME and HOME, never the real ones.
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authPath } from "../src/auth/credentials.js";
import { protectedFiles, setUserProtectedPaths } from "../src/state.js";

const saved = { KISO_HOME: process.env.KISO_HOME, HOME: process.env.HOME };
let H = "";

beforeEach(() => {
	H = realpathSync(mkdtempSync(join(tmpdir(), "kiso-store-path-")));
	process.env.HOME = H;
	process.env.KISO_HOME = join(H, ".kiso");
});
afterEach(() => {
	setUserProtectedPaths(undefined);
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe("the protected list", () => {
	it("starts with the store the credential writer writes", () => {
		expect(protectedFiles()[0]).toBe(authPath());
		expect(authPath()).toBe(join(H, ".kiso", "auth.json"));
	});

	it("then the user's own files, `~/` taken against the home directory", () => {
		setUserProtectedPaths(["~/secret.md", "/srv/keys.env"]);
		expect(protectedFiles()).toEqual([authPath(), join(H, "secret.md"), "/srv/keys.env"]);
	});
});
