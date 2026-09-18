/**
 * 0.40.0 — the catastrophe floor (launch-weekend plan §4, minimum shape;
 * owner, 2026-09-17: "bypass stays bypass: `rm -rf /tmp/probe` runs. The
 * floor refuses only unrecoverable targets").
 *
 * A destructive command whose target cannot be recovered is REFUSED, in
 * every mode, bypass included, as a precondition — a chain member that
 * denies, and a deny is what nothing outranks. The destructive commands
 * are `rm`, `git clean -f`, `git reset --hard`, `git checkout -- <paths>`
 * and `find … -delete`. The unrecoverable targets:
 *
 *  - `/`, a system root (`/usr`, `/etc`, `/Users`, …), the home directory;
 *  - the workspace root, or any directory above it;
 *  - a well-known home subtree — `~/.ssh`, `~/.config`, `~/.kiso`,
 *    `~/.gnupg`, `~/.aws` — or anything inside one;
 *  - a wildcard over any of those (`~/*`, `/*`, `*` at the workspace root);
 *  - a target that is only a variable (`$DIR/`, `"$X"/*`) — empty, it is
 *    the root of whatever comes after it.
 *
 * This is a reading of the command line, not a guarantee: the sandbox is
 * the guarantee, and it comes after the launch. So the reading errs toward
 * seeing a command — it looks inside `$( )`, backticks, `sh -c` and
 * through `sudo`/`env`/`command` — and a line it cannot follow is simply
 * not refused (a floor that refused whatever it could not read would be a
 * second approval tier, not a floor).
 *
 * The same resolver as the read-only allow decides where a path goes.
 * Default on; `"floor": "off"` in the USER config turns it off, and a
 * project config cannot — a repository must not be able to lower it.
 */

import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { PolicyCall, PolicyVerdict } from "@vincemakes/kiso-core";
import type { KisoExtension } from "@vincemakes/kiso-runtime";
import { looseCommands, parseShellLoose, resolveShellPath, type LooseWord } from "./shell-words.js";

export type FloorVerdict = { readonly refused: false } | { readonly refused: true; readonly why: string };

const SYSTEM_ROOTS = [
	"/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/mnt", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys",
	"/tmp", "/usr", "/var", "/Applications", "/Library", "/System", "/Users", "/Volumes", "/cores", "/private", "/private/etc",
	"/private/tmp", "/private/var",
];
const HOME_SUBTREES = [".ssh", ".config", ".kiso", ".gnupg", ".aws"];

interface Where {
	readonly root: string;
	readonly home: string;
	/** Canonical forms, computed ONCE per check: a line of many targets
	 *  used to realpath every system root for every one of them. */
	readonly rootReal: string;
	readonly homeReal: string;
	readonly sys: readonly { readonly name: string; readonly real: string }[];
	readonly subtrees: readonly { readonly name: string; readonly real: string }[];
}

/** Memoized per (workspace, home): the roots do not move within a session,
 *  and resolving thirty-five of them cost every shell call ~4 ms. */
const WHERE = new Map<string, Where>();

function where(root: string, home: string): Where {
	const key = `${root}\0${home}`;
	const hit = WHERE.get(key);
	if (hit !== undefined) return hit;
	const w = computeWhere(root, home);
	WHERE.set(key, w);
	return w;
}

function computeWhere(root: string, home: string): Where {
	const real = (p: string): string => resolveShellPath(root, "/", p).canonical;
	return {
		root,
		home,
		rootReal: real(root),
		homeReal: real(home),
		sys: SYSTEM_ROOTS.map((name) => ({ name, real: real(name) })),
		subtrees: HOME_SUBTREES.map((name) => ({ name, real: real(join(home, name)) })),
	};
}

/** B6: the candidate directories a command may run in are UNIQUE and at
 *  most this many. `;`-joined cds doubled the set: 30 of them hung the
 *  event loop, 400 exhausted the heap. Past the bound the set collapses to
 *  the newest candidate, home and the workspace root — the three a
 *  catastrophe is judged against. */
const MAX_CWDS = 8;

function capCwds(w: Where, list: readonly string[]): string[] {
	const unique = [...new Set(list)];
	return unique.length <= MAX_CWDS ? unique : [...new Set([unique[0]!, w.home, w.root])];
}

const canon = (w: Where, cwd: string, p: string): string => resolveShellPath(w.root, cwd, p).canonical;
const within = (parent: string, p: string): boolean => {
	const rel = relative(parent, p);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Why `p` (canonical) is unrecoverable, or null. `over` is true for a
 *  wildcard over `p` rather than `p` itself — the same set, since
 *  emptying a directory is removing everything it held. */
function unrecoverable(w: Where, p: string, over: boolean): string | null {
	const what = (s: string): string => (over ? `a wildcard over ${s}` : s);
	if (p === "/") return what("/");
	if (p === w.homeReal) return what("the home directory");
	for (const sys of w.sys) if (p === sys.real) return what(`a system root (${sys.name})`);
	if (p === w.rootReal) return what("the workspace root");
	if (within(p, w.rootReal)) return what(`a directory above the workspace (${p})`);
	for (const sub of w.subtrees) if (within(sub.real, p)) return what(`~/${sub.name}`);
	return null;
}

/** One target word, from each directory the command might run in. */
function targetWhy(w: Where, cwds: readonly string[], word: LooseWord): string | null {
	if (word.variableOnly) return `a target that is only a variable (${word.text})`;
	const expand = (s: string): string => (word.tilde && (s === "~" || s.startsWith("~/")) ? w.home + s.slice(1) : s);
	for (const cwd of cwds) {
		if (word.unknownAt < 0) {
			const why = unrecoverable(w, canon(w, cwd, expand(word.text)), false);
			if (why !== null) return why;
			continue;
		}
		// A variable FIRST, with something literal after it (`$X/build`),
		// can be anything at all; only a variable-only target is refused.
		if (word.unknownAt === 0 && !word.unknownIsGlob) continue;
		// A wildcard — or a variable that, empty, leaves its literal prefix
		// (`~/$X`) — ranges over the directory of that prefix, when the
		// unknown part starts the last component or follows only dots
		// (`~/.*`). `build/foo*` ranges over some of build's entries, never
		// over build.
		const prefix = expand(word.text.slice(0, word.unknownAt));
		const lastSlash = prefix.lastIndexOf("/");
		const component = prefix.slice(lastSlash + 1);
		if (!/^\.*$/.test(component)) continue;
		const dir = lastSlash < 0 ? "." : prefix.slice(0, lastSlash + 1) || "/";
		const why = unrecoverable(w, canon(w, cwd, dir), true);
		if (why !== null) return why;
	}
	return null;
}

const WRAPPER_ARG: Readonly<Record<string, readonly string[]>> = {
	sudo: ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"],
	doas: ["-u", "-C"],
	nice: ["-n"],
	exec: ["-a"],
	env: ["-u", "-C", "-S"],
	command: [],
	builtin: [],
	nohup: [],
	time: [],
};

/** Past `sudo -u x`, `env A=1`, `command`, … to the command that runs. */
function unwrap(argv: readonly LooseWord[]): readonly LooseWord[] {
	let a = argv;
	for (;;) {
		const name = a[0]?.text;
		if (name === undefined || !Object.hasOwn(WRAPPER_ARG, name)) return a;
		let i = 1;
		while (i < a.length && (a[i]!.text.startsWith("-") || (name === "env" && a[i]!.text.includes("=")))) {
			i += WRAPPER_ARG[name]!.includes(a[i]!.text) ? 2 : 1;
		}
		a = a.slice(i);
	}
}

const operands = (args: readonly LooseWord[]): LooseWord[] => {
	const out: LooseWord[] = [];
	let rest = false;
	for (const a of args) {
		if (!rest && a.text === "--") rest = true;
		else if (rest || !a.text.startsWith("-")) out.push(a);
	}
	return out;
};

const literal = (text: string): LooseWord => ({ text, unknownAt: -1, unknownIsGlob: false, tilde: false, variableOnly: false });

/** `sh -c '…'`, `bash -lc '…'`, `eval …`: the command line inside. */
function innerLine(argv: readonly LooseWord[]): string | null {
	const name = basename(argv[0]?.text ?? "");
	if (name === "eval") return argv.slice(1).map((a) => a.text).join(" ");
	if (!/^(ba|z|da|k)?sh$/.test(name)) return null;
	const at = argv.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a.text));
	return at < 0 ? null : (argv[at + 1]?.text ?? null);
}

/** The destructive command's targets, or null when the command is not
 *  destructive. `cwd` handling for `git -C` is returned alongside. */
function destructiveTargets(argv: readonly LooseWord[]): { targets: LooseWord[]; cd?: LooseWord } | null {
	const name = basename(argv[0]?.text ?? "");
	const args = argv.slice(1);
	if (name === "rm") return { targets: operands(args) };
	if (name === "find") {
		if (!args.some((a) => a.text === "-delete")) return null;
		const paths: LooseWord[] = [];
		for (const a of args) {
			if (a.text.startsWith("-") || a.text === "!" || a.text === "(") break;
			paths.push(a);
		}
		return { targets: paths.length > 0 ? paths : [literal(".")] };
	}
	if (name === "git") {
		let i = 0;
		let cd: LooseWord | undefined;
		while (i < args.length && args[i]!.text.startsWith("-")) {
			const t = args[i]!.text;
			if (t === "-C" && i + 1 < args.length) {
				cd = args[i + 1];
				i += 2;
			} else if (t === "-c") i += 2;
			else i += 1;
		}
		const sub = args[i]?.text;
		const rest = args.slice(i + 1);
		const cwdTarget = [literal(".")];
		const withCd = (targets: LooseWord[]) => (cd !== undefined ? { targets, cd } : { targets });
		if (sub === "clean") {
			const force = rest.some((a) => a.text === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a.text));
			if (!force) return null;
			const paths = operands(rest.filter((a, k) => !(k > 0 && (rest[k - 1]!.text === "-e" || rest[k - 1]!.text === "--exclude"))));
			return withCd(paths.length > 0 ? paths : cwdTarget);
		}
		if (sub === "reset") return rest.some((a) => a.text === "--hard") ? withCd(cwdTarget) : null;
		if (sub === "checkout") {
			const dd = rest.findIndex((a) => a.text === "--");
			return dd < 0 ? null : withCd(rest.slice(dd + 1));
		}
	}
	return null;
}

/**
 * Would the floor refuse this command line? `workspaceRoot` is where the
 * shell runs it.
 */
export function floorCheck(commandLine: string, workspaceRoot: string, home: string = homedir()): FloorVerdict {
	const w = where(workspaceRoot, home);
	// Where the next command may run. After `cd x`: `&&` means only if the
	// cd worked — x; `||` means only if it failed — where it was; anything
	// else, either. The newest candidate first, so a refusal names it.
	let cwds: string[] = [workspaceRoot];
	let lastCd: { readonly to: string[]; readonly from: string[] } | null = null;
	const seen = new Set<string>();
	const check = (line: string, depth: number): FloorVerdict => {
		for (const { argv: raw, joinedBy } of looseCommands(parseShellLoose(line))) {
			if (lastCd !== null) {
				cwds = capCwds(w, joinedBy === "&&" ? lastCd.to : joinedBy === "||" ? lastCd.from : [...lastCd.to, ...lastCd.from]);
				if (joinedBy !== "&&") lastCd = null;
			}
			const argv = unwrap(raw);
			const name = basename(argv[0]?.text ?? "");
			const inner = innerLine(argv);
			if (inner !== null) {
				if (depth < 4 && !seen.has(inner)) {
					seen.add(inner);
					const v = check(inner, depth + 1);
					if (v.refused) return v;
				}
				continue;
			}
			if (name === "cd" || name === "pushd") {
				const to = argv[1];
				const from = lastCd?.from ?? cwds;
				// `cd` with nothing — or with a variable that may be empty, or
				// anything unknown — may land at home, or anywhere below it
				if (to === undefined || to.unknownAt >= 0 || to.variableOnly) lastCd = { to: capCwds(w, [w.home, ...cwds]), from };
				else if (to.text === "-") lastCd = { to: cwds, from };
				else {
					const dest = to.tilde && (to.text === "~" || to.text.startsWith("~/")) ? home + to.text.slice(1) : to.text;
					lastCd = { to: capCwds(w, cwds.map((c) => resolve(c, dest))), from };
				}
				continue;
			}
			const d = destructiveTargets(argv);
			if (d === null) continue;
			let here = cwds;
			if (d.cd !== undefined) {
				if (d.cd.unknownAt >= 0) here = [...new Set([...cwds, w.home])];
				else here = cwds.map((c) => resolve(c, d.cd!.text));
			}
			for (const t of d.targets) {
				const why = targetWhy(w, here, t);
				if (why !== null) return { refused: true, why: `${argv.map((a) => a.text).join(" ")} — its target is ${why}` };
			}
		}
		return { refused: false };
	};
	return check(commandLine, 0);
}

/** Is there a destructive command anywhere in the line, whatever its
 *  target? A saved allow is never inherited by one (plan §4). */
export function isDestructive(commandLine: string): boolean {
	const visit = (line: string, depth: number): boolean =>
		looseCommands(parseShellLoose(line)).some(({ argv: raw }) => {
			const argv = unwrap(raw);
			const inner = innerLine(argv);
			if (inner !== null) return depth < 4 && visit(inner, depth + 1);
			return destructiveTargets(argv) !== null;
		});
	return visit(commandLine, 0);
}

const ABSTAIN: PolicyVerdict = { action: "abstain" };

/** The chain member, at the chain's head: DENY or ABSTAIN. */
export function floorExtension(on: () => boolean, workspaceRoot: () => string, check: typeof floorCheck = floorCheck): KisoExtension {
	return {
		name: "floor",
		approvals: [
			{
				decide: (call) => {
					if (call.name !== "shell" || !on()) return ABSTAIN;
					const command = call.input.command;
					if (typeof command !== "string") return ABSTAIN;
					// B6: a read that THROWS is not "a line it cannot follow" — it
					// is a line that knocked the reader out, and letting the
					// runtime degrade the throw to an ask handed it to bypass's
					// allow. The floor denies what it could not read.
					let v: FloorVerdict;
					try {
						v = check(command, workspaceRoot());
					} catch (err) {
						return { action: "deny", reason: `the floor could not read this line (${err instanceof Error ? err.name : "error"}) — kiso does not run it.` };
					}
					return v.refused ? { action: "deny", reason: `the floor refused this: ${v.why}. kiso never runs it, in any mode.` } : ABSTAIN;
				},
			},
		],
	};
}

/** Plan §4: "destructive commands never inherit a saved allow in the
 *  asking modes" — the predicate the saved-allow wrap
 *  (protected-writes.ts) is given, keyed on destructiveness, not on the
 *  target: a saved allow never runs even `rm -rf build` unasked. */
export function isDestructiveCall(call: PolicyCall): boolean {
	if (call.name !== "shell" || typeof call.input.command !== "string") return false;
	// B6: unreadable is treated as destructive — the saved allow abstains
	try {
		return isDestructive(call.input.command);
	} catch {
		return true;
	}
}
