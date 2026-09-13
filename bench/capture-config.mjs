#!/usr/bin/env node
/**
 * THE PER-ARM CONFIGURATION MANIFEST (protocol v2 §10.3, amendment 4b).
 *
 * A comparison between products is only attributable if every arm's record
 * says WHAT ACTUALLY RAN. Before this, `meta.json` was written for the kiso
 * arm alone and carried:
 *
 *   - `model: 'deepseek-v4-flash'` as a hardcoded string — asserted, never
 *     observed. The protocol asks for the SERVED id, confirmed.
 *   - `commit:` from the HOST checkout's HEAD — the same defect as the
 *     version field fixed in PR C: hand the runner a pinned published bin
 *     and the record names a commit that bin was never built from.
 *   - no package digest, no reasoning controls, no environment record, and
 *     nothing at all for pi or Claude Code.
 *
 * Rules this file keeps:
 *   1. ASK THE ARTIFACT, never the checkout around it.
 *   2. An unanswerable field is `null` with a stated reason — never a guess,
 *      never a borrowed value from a neighbouring arm.
 *   3. Environment is recorded by NAME ONLY. A configuration manifest that
 *      captured values would archive credentials.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isMain } from "../scripts/is-main.mjs";

/** Run a command and return its trimmed stdout, or null — with the reason.
 *  A non-zero exit NEVER yields a value: a failing probe that printed to
 *  stdout once had its error message recorded as a version. */
export function probe(cmd, args, cwd) {
	try {
		const out = execFileSync(cmd, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 });
		const v = out.replace(/\r/g, "").trim().split("\n").pop()?.trim() ?? "";
		return v === "" ? { value: null, why: "the command printed nothing" } : { value: v, why: null };
	} catch (e) {
		return { value: null, why: `the command failed (${(e && e.code) || "non-zero exit"})` };
	}
}

/** A version string must LOOK like one. Anything else is an arm answering a
 *  different question, and is recorded as unanswered rather than believed. */
export function asVersion(s) {
	return typeof s === "string" && /^v?\d+\.\d+\.\d+/.test(s) ? s.replace(/^v/, "") : null;
}

/** sha256 OF THE ENTRY FILE — not of the package, and not of its dependency
 *  closure. An entry point can be byte-identical while the tree beneath it
 *  differs, so this pins WHICH FILE RAN and nothing more. Calling it a
 *  "package digest" would claim a guarantee it does not give. */
export function digestOf(path) {
	try {
		const real = realpathSync(path);
		if (!statSync(real).isFile()) return null;
		return `sha256-${createHash("sha256").update(readFileSync(real)).digest("hex")}`;
	} catch {
		return null;
	}
}

/** The npm package identity behind an installed executable, when the
 *  executable resolves inside a node_modules tree. */
export function packageOf(binPath) {
	try {
		let dir = realpathSync(binPath);
		for (let i = 0; i < 8; i++) {
			dir = dir.replace(/\/[^/]+$/, "");
			const m = `${dir}/package.json`;
			if (existsSync(m)) {
				const d = JSON.parse(readFileSync(m, "utf8"));
				if (d.name && d.version) return { name: d.name, version: d.version };
			}
		}
	} catch {
		/* not an installed package — a checkout, a shim, or a bare name */
	}
	return null;
}

export function captureArm({ tool, command, cwd = process.cwd(), envNames = [], model = null, endpoint = null, reasoning = null, extensions = null }) {
	const [bin, ...args] = command;
	// The executable ACTUALLY invoked, resolved — not the name given.
	const resolved = probe("/usr/bin/which", [bin], cwd).value ?? (existsSync(bin) ? bin : null);
	const versionProbe = probe(bin, [...args, "--version"], cwd);
	const version = asVersion(versionProbe.value);
	return {
		tool,
		command,
		executable: resolved ? realpathSync(resolved) : null,
		executableWhy: resolved ? null : "not on PATH and not a file — a bare name or a shell function",
		entryDigest: resolved ? digestOf(resolved) : null,
		// Stated so the field cannot be read as more than it is.
		entryDigestScope: "the entry file only — not the package, not its dependency closure",
		package: resolved ? packageOf(resolved) : null,
		version,
		versionWhy: version === null ? (versionProbe.why ?? `did not report a version (got ${JSON.stringify(versionProbe.value)})`) : null,
		model,
		endpoint,
		// Amendment 4b: the effort key is part of the inference configuration
		// and must be stated per arm — a comparison of products at different
		// reasoning levels compares settings, not products.
		reasoning,
		extensions,
		// NAMES ONLY. Values would archive credentials.
		envNames: [...envNames].sort(),
		capturedAt: new Date().toISOString(),
	};
}

if (isMain(import.meta.url)) {
	const [tool, ...rest] = process.argv.slice(2);
	if (!tool || rest.length === 0) {
		console.error("usage: capture-config.mjs <tool> <command> [args...]");
		process.exit(2);
	}
	console.log(JSON.stringify(captureArm({ tool, command: rest }), null, 1));
}
