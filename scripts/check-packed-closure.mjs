#!/usr/bin/env node
/**
 * REL-0340-F1 — THE PACKED SMOKE MUST NOT NAME ITS OWN CLOSURE.
 *
 * `bench/packed-pty-smoke.sh` carried a hand-written list of package names.
 * It said 14; the workspace has 15 publishable packages. The one it omitted
 * was `@vincemakes/kiso-provider-openai-responses`, and it had been missing
 * for four releases — including the one that changed that very package.
 *
 * A list a human maintains beside a set a build produces will drift, and the
 * drift is silent: the script passed, having nested one package fewer than
 * the release ships. So the script derives the closure now, and this gate
 * asserts the derivation agrees with the workspace — a second reader of the
 * same fact, so a broken derivation cannot quietly agree with itself.
 *
 * Zero dependencies: this runs in CI before any install step.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

/** Every publishable workspace package, from the manifests themselves. */
export function publishablePackages(root = ROOT) {
	// An ARGV array, never a shell string: `git ls-files *package.json` goes
	// through /bin/sh, which expands the glob against the cwd and matches the
	// root manifest alone — the closure then comes back EMPTY, and an empty
	// closure is a failed read, not a true answer.
	const files = execFileSync("git", ["ls-files", "*package.json"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
	const names = [];
	for (const f of files) {
		if (f === "package.json" || f.includes("node_modules")) continue;
		const d = JSON.parse(readFileSync(resolve(root, f), "utf8"));
		if (!d.private) names.push(d.name);
	}
	return names.sort();
}

/** The names the packed smoke would nest, read out of the script itself.
 *
 *  COMMENTS ARE STRIPPED FIRST. This gate scans text, and text includes the
 *  prose explaining the gate: the first version of this file failed on its
 *  own comment naming the package the old list omitted. A gate that cannot
 *  tell code from a sentence about code is the pty-manifest lesson again. */
export function namesInPackedSmoke(source) {
	const code = source
		.split("\n")
		.filter((line) => !/^\s*#/.test(line))
		.join("\n");
	return [...new Set(code.match(/@vincemakes\/[a-z0-9-]+/g) ?? [])].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const pkgs = publishablePackages();
	const errs = [];
	// The closure must be non-empty before anything is compared to it.
	if (pkgs.length === 0) errs.push("derived ZERO publishable packages — a failed read, not an empty workspace");
	const script = readFileSync(resolve(ROOT, "bench/packed-pty-smoke.sh"), "utf8");
	const named = namesInPackedSmoke(script);
	// The script may DERIVE rather than name; a derivation names nothing, and
	// that is the passing shape. What must never happen is a partial list.
	if (named.length > 0) {
		const missing = pkgs.filter((p) => !named.includes(p));
		const extra = named.filter((p) => !pkgs.includes(p));
		if (missing.length) errs.push(`packed-pty-smoke.sh names ${named.length} of ${pkgs.length} publishable packages — missing: ${missing.join(", ")}`);
		if (extra.length) errs.push(`packed-pty-smoke.sh names packages that are not publishable: ${extra.join(", ")}`);
	}
	if (errs.length) {
		console.error("[packed-closure] FAIL:");
		for (const e of errs) console.error(`  ${e}`);
		process.exit(1);
	}
	console.log(`[packed-closure] OK — ${pkgs.length} publishable packages, and the packed smoke ${named.length === 0 ? "derives its closure" : "names them all"}`);
}
