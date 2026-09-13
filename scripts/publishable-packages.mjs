#!/usr/bin/env node
/**
 * THE publishable closure, derived once. Printed space-separated so a shell
 * script can read it, and importable so a gate can compare against it.
 *
 * Callers must still assert the COUNT they expect. This returns what it
 * finds; a derivation that finds nothing returns nothing, and an empty
 * closure is a failed read rather than an empty workspace.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMain } from "./is-main.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

export function publishablePackages(root = ROOT) {
	// An ARGV array, never a shell string: through /bin/sh the glob is
	// expanded against the cwd and matches the root manifest alone.
	const files = execFileSync("git", ["ls-files", "*package.json"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
	const names = [];
	for (const f of files) {
		if (f === "package.json" || f.includes("node_modules")) continue;
		const d = JSON.parse(readFileSync(resolve(root, f), "utf8"));
		if (!d.private) names.push(d.name);
	}
	return names.sort();
}

/** Dependency order: every workspace dependency before its dependent, so
 *  the closure can be installed in sequence if a caller ever wants to. The
 *  CLI depends on all fourteen others and therefore comes last. */
export function inDependencyOrder(root = ROOT) {
	const files = execFileSync("git", ["ls-files", "*package.json"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
	const deps = new Map();
	for (const f of files) {
		if (f === "package.json" || f.includes("node_modules")) continue;
		const d = JSON.parse(readFileSync(resolve(root, f), "utf8"));
		if (d.private) continue;
		deps.set(d.name, Object.keys({ ...d.dependencies, ...d.peerDependencies }).filter((n) => n.startsWith("@vincemakes/")));
	}
	const out = [];
	const seen = new Set();
	const visit = (n, stack = []) => {
		if (seen.has(n)) return;
		if (stack.includes(n)) throw new Error(`dependency cycle: ${[...stack, n].join(" -> ")}`);
		for (const d of deps.get(n) ?? []) if (deps.has(d)) visit(d, [...stack, n]);
		seen.add(n);
		out.push(n);
	};
	for (const n of [...deps.keys()].sort()) visit(n);
	return out;
}

if (isMain(import.meta.url)) {
	console.log((process.argv[2] === "--dependency-order" ? inDependencyOrder() : publishablePackages()).join(" "));
}
