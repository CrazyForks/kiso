/**
 * The search corpus — one definition shared by search_text and list_dir's
 * glob, so the two cannot drift. They drifted before this existed:
 * `list_dir` showed every dot entry and `search_text` skipped all of them,
 * which is what two walkers gets you.
 *
 * The rules that are easy to get wrong, and why each is here:
 *
 *  - a NESTED .gitignore applies to its own subtree and not above it; a
 *    matcher built from the root file alone silently over-searches
 *  - NEGATION re-admits, and a hand-rolled matcher usually forgets it
 *  - `.env` is excluded even when nothing ignores it. That test is GREEN
 *    BEFORE this change too, because today every dot entry is skipped —
 *    it is a REGRESSION GUARD, not a red proof, and its job is to stay
 *    green while the widening below goes red
 *  - the three template names exist to be READ, so they are carved out by
 *    exact name
 *  - depth and the entry cap are different truncations with different
 *    remedies, so they are reported separately and neither is mentioned
 *    when it did not happen
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { globToRegExp, isCredentialPath, walkCorpus } from "../src/corpus.js";

function ws(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "kiso-corpus-"));
	for (const [rel, body] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, body);
	}
	return root;
}
const names = (root: string, opts = {}): string[] => walkCorpus({ workspaceRoot: root, ...opts }).files.sort();

describe("the search corpus", () => {
	it("with NO root .gitignore, keeps today's conservative rule — every dot entry skipped", () => {
		const root = ws({ "src/a.ts": "a", ".github/w.yml": "w", ".env": "SECRET=1", "node_modules/x/i.js": "x" });
		expect(names(root)).toEqual(["src/a.ts"]);
	});

	it("with a root .gitignore, a committed dotfile becomes searchable", () => {
		const root = ws({ ".gitignore": "dist\n", "src/a.ts": "a", ".github/w.yml": "w", "dist/b.js": "b" });
		const out = names(root);
		expect(out).toContain(".github/w.yml"); // the widening — red before this change
		expect(out).not.toContain("dist/b.js"); // the user's own declaration
	});

	it("honours a NESTED .gitignore in its own subtree, and not above it", () => {
		const root = ws({
			".gitignore": "*.tmp\n",
			"keep.log": "top",
			"pkg/.gitignore": "*.log\n",
			"pkg/inner.log": "nested",
			"pkg/inner.ts": "code",
		});
		const out = names(root);
		expect(out).not.toContain("pkg/inner.log"); // the nested file applies here
		expect(out).toContain("keep.log");          // and NOT above it
		expect(out).toContain("pkg/inner.ts");
	});

	it("honours NEGATION — the rule a hand-rolled matcher forgets", () => {
		const root = ws({ ".gitignore": "*.log\n!keep.log\n", "a.log": "x", "keep.log": "y" });
		const out = names(root);
		expect(out).not.toContain("a.log");
		expect(out).toContain("keep.log");
	});

	it("always skips .git, even though nothing ignores it", () => {
		const root = ws({ ".gitignore": "dist\n", ".git/config": "[core]", ".git/objects/ab/cd": "x", "src/a.ts": "a" });
		// `.gitignore` itself IS searchable and belongs in this list: it is a
		// committed dotfile, and "a file the user commits is not a secret by
		// the user's own declaration" is the whole rule. `.git/` is machinery.
		expect(names(root)).toEqual([".gitignore", "src/a.ts"]);
	});

	it("excludes .env and .env.* even when NOT gitignored — the regression guard", () => {
		const root = ws({ ".gitignore": "dist\n", ".env": "KEY=1", ".env.local": "KEY=2", ".env.production": "KEY=3", "src/a.ts": "a" });
		const out = names(root);
		expect(out).not.toContain(".env");
		expect(out).not.toContain(".env.local");
		expect(out).not.toContain(".env.production");
	});

	it("excludes the whole CREDENTIAL SET, and only it", () => {
		const root = ws({
			".gitignore": "dist\n",
			".envrc": "export AWS_SECRET_ACCESS_KEY=1",
			".netrc": "machine x login y password z",
			"keys/id_rsa": "PRIVATE", "keys/id_ed25519": "PRIVATE", "keys/id_ecdsa": "PRIVATE", "keys/id_dsa": "PRIVATE",
			"certs/server.pem": "-----BEGIN",
			// a public key is PUBLIC — a different name, and searchable
			"keys/id_rsa.pub": "ssh-rsa AAAA",
			// DECLARED RE-PIN (RO-F4, the owner's 0.40.7 ruling): `.npmrc` was
			// here as a deliberate omission; it is IN now, with the other
			// names the read-only shell rule already treated as credentials
			".npmrc": "//registry:_authToken=literal-token",
			".pypirc": "[pypi]\npassword = x",
			".git-credentials": "https://u:p@example.invalid",
			".htpasswd": "u:$apr1$x",
			// deliberately OUT of the set: the omissions are decisions
			"app.key": "not necessarily a secret",
		});
		const out = names(root);
		for (const excluded of [".envrc", ".netrc", "keys/id_rsa", "keys/id_ed25519", "keys/id_ecdsa", "keys/id_dsa", "certs/server.pem", ".npmrc", ".pypirc", ".git-credentials", ".htpasswd"]) {
			expect(out, `${excluded} must be excluded`).not.toContain(excluded);
		}
		// and the two that are NOT in the set stay searchable, which is
		// the half that proves the rule is a set and not a hunch
		expect(out).toContain("keys/id_rsa.pub");
		expect(out).toContain("app.key");
	});

	it("RO-F4: the directory-scoped credential files are excluded by PATH; their neighbours are not", () => {
		const root = ws({
			".gitignore": "dist\n", // declared: dot-directories are walked, so the path rule is what excludes
			".aws/credentials": "[default]\naws_secret_access_key = x",
			".aws/config": "[default]\nregion = eu-west-1",
			".kube/config": "users: [token: x]",
			".docker/config.json": "{\"auths\": {}}",
			".docker/daemon.json": "{}",
			".config/gh/hosts.yml": "oauth_token: x",
			"src/credentials": "a plain file that happens to be called that",
		});
		const out = names(root);
		for (const excluded of [".aws/credentials", ".kube/config", ".docker/config.json", ".config/gh/hosts.yml"]) {
			expect(out, `${excluded} must be excluded`).not.toContain(excluded);
		}
		for (const kept of [".aws/config", ".docker/daemon.json", "src/credentials"]) expect(out, `${kept} is not a credential`).toContain(kept);
		expect(isCredentialPath("/home/u/project/.AWS/Credentials"), "folded like a case-insensitive disk").toBe(true);
		expect(isCredentialPath("src/credentials")).toBe(false);
	});

	it("carves out the three template names BY EXACT NAME — they exist to be read", () => {
		const root = ws({
			".gitignore": "dist\n",
			".env.example": "KEY=", ".env.sample": "KEY=", ".env.template": "KEY=",
			".env.examples": "KEY=1", // NOT one of the three — a near-miss name stays excluded
			".environment": "x",      // a prefix rule would have swallowed this
			".envoy.yaml": "x",       // and this
		});
		const out = names(root);
		expect(out).toContain(".env.example");
		expect(out).toContain(".env.sample");
		expect(out).toContain(".env.template");
		expect(out).not.toContain(".env.examples");
		// enumerated, not prefix-matched: ordinary files that merely start
		// the same way are not credentials
		expect(out).toContain(".environment");
		expect(out).toContain(".envoy.yaml");
	});

	it("reports a DEPTH cut and a CAP cut separately, and neither when neither happened", () => {
		const shallow = ws({ ".gitignore": "x\n", "a.ts": "a", "b.ts": "b" });
		const r1 = walkCorpus({ workspaceRoot: shallow });
		expect({ depth: r1.cutByDepth, cap: r1.cutByCap }).toEqual({ depth: false, cap: false });

		const deepFiles: Record<string, string> = { ".gitignore": "x\n" };
		deepFiles[`${Array.from({ length: 12 }, (_, i) => `d${i}`).join("/")}/deep.ts`] = "deep";
		const r2 = walkCorpus({ workspaceRoot: ws(deepFiles) });
		expect(r2.cutByDepth).toBe(true);
		expect(r2.cutByCap).toBe(false);

		const many: Record<string, string> = { ".gitignore": "x\n" };
		for (let i = 0; i < 250; i += 1) many[`f${i}.ts`] = "x";
		const r3 = walkCorpus({ workspaceRoot: ws(many), maxEntries: 200 });
		expect(r3.cutByCap).toBe(true);
		expect(r3.files).toHaveLength(200);
		expect(r3.cutByDepth).toBe(false);
	});

	it("returns workspace-RELATIVE paths, never absolute", () => {
		const root = ws({ ".gitignore": "x\n", "src/deep/a.ts": "a" });
		expect(names(root)).toEqual([".gitignore", "src/deep/a.ts"]);
	});
});

describe("globToRegExp", () => {
	const m = (p: string, s: string): boolean => globToRegExp(p).test(s);

	it("`*` stops at a separator and `**` crosses it", () => {
		expect(m("*.ts", "a.ts")).toBe(true);
		expect(m("*.ts", "src/a.ts")).toBe(false);
		expect(m("src/**/*.ts", "src/deep/down/a.ts")).toBe(true);
	});

	it("a leading `**/` matches ZERO directories too — the one a naive translation gets wrong", () => {
		expect(m("**/*.ts", "a.ts")).toBe(true);
		expect(m("**/*.ts", "src/a.ts")).toBe(true);
		expect(m("**/*.ts", "src/deep/a.ts")).toBe(true);
	});

	it("`?` is exactly one character and never a separator", () => {
		expect(m("a?.ts", "ab.ts")).toBe(true);
		expect(m("a?.ts", "abc.ts")).toBe(false);
		expect(m("a?b", "a/b")).toBe(false);
	});

	it("regex metacharacters in a path are literal, not syntax", () => {
		expect(m("a+b.ts", "a+b.ts")).toBe(true);
		expect(m("a+b.ts", "aab.ts")).toBe(false);
		expect(m("v1.2.3/*.js", "v1.2.3/x.js")).toBe(true);
		expect(m("v1.2.3/*.js", "v1X2X3/x.js")).toBe(false);
	});

	it("is anchored at both ends", () => {
		expect(m("*.ts", "a.ts.bak")).toBe(false);
		expect(m("src/*", "xsrc/a")).toBe(false);
	});
});
