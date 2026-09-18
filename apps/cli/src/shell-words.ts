/**
 * The shell command line, READ — never run — for the approval chain
 * (0.40.0: the read-only allow now, the catastrophe floor next).
 *
 * This is not a shell. It is a lexer for the subset of POSIX sh whose
 * meaning can be known WITHOUT running anything, and it refuses the rest:
 * a command line that uses expansion (`$`, backticks, globs, a leading
 * `~`, braces), grouping or subshells, background jobs, heredocs, or a
 * leading variable assignment does not parse, and a caller that cannot
 * parse a line must treat it as unknown. The refusals are the design —
 * every construct accepted here is one whose words are exactly the words
 * the shell will pass to the program.
 *
 * What it produces is a LIST of pipelines joined by `;`, `&&`, `||` (a
 * newline counts as `;`), each pipeline a series of simple commands joined
 * by `|`, each command an argv plus its redirections.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export interface Redirect {
	/** The descriptor written before the operator (`2>`), null when none
	 *  was written, or "&" for `&>` (stdout and stderr together). */
	readonly fd: number | "&" | null;
	readonly op: ">" | ">>" | "<" | ">&";
	readonly target: string;
}

export interface SimpleCommand {
	readonly argv: readonly string[];
	readonly redirects: readonly Redirect[];
}

export interface Pipeline {
	/** How this pipeline joins the one before it; null for the first. */
	readonly joinedBy: ";" | "&&" | "||" | null;
	readonly stages: readonly SimpleCommand[];
}

export type ParseResult = { readonly ok: true; readonly list: readonly Pipeline[] } | { readonly ok: false; readonly why: string };

const GLOB = new Set(["*", "?", "["]);

/**
 * Parse a command line, or say why not. Pure: no filesystem, no
 * environment.
 */
export function parseShell(src: string): ParseResult {
	const list: Pipeline[] = [];
	let stages: SimpleCommand[] = [];
	let argv: string[] = [];
	let redirects: Redirect[] = [];
	let joinedBy: Pipeline["joinedBy"] = null;
	// The word being built, and whether any of it has been seen yet — an
	// empty quoted string `''` is a word, an empty buffer is not.
	let word = "";
	let inWord = false;
	let wordQuoted = false;
	// Where in `word` the first quoted character sits: an assignment is
	// `NAME=` written UNQUOTED, so `FOO="x" cmd` is one and `"FOO=x" cmd`
	// is not.
	let quotedFrom = Number.POSITIVE_INFINITY;
	// A redirection operator waiting for its target word.
	let pending: { fd: Redirect["fd"]; op: Redirect["op"] } | null = null;

	const fail = (why: string): ParseResult => ({ ok: false, why });

	const endWord = (): string | null => {
		if (!inWord) return null;
		const w = word;
		if (pending !== null) {
			redirects.push({ fd: pending.fd, op: pending.op, target: w });
			pending = null;
		} else {
			const assign = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(w);
			if (argv.length === 0 && assign !== null && assign[0].length <= quotedFrom) return "a leading variable assignment";
			argv.push(w);
		}
		word = "";
		inWord = false;
		wordQuoted = false;
		quotedFrom = Number.POSITIVE_INFINITY;
		return null;
	};
	const endCommand = (): string | null => {
		if (pending !== null) return "a redirection with no target";
		if (argv.length === 0) return redirects.length > 0 ? "a redirection with no command" : "an empty command";
		stages.push({ argv, redirects });
		argv = [];
		redirects = [];
		return null;
	};
	const endPipeline = (next: Pipeline["joinedBy"]): string | null => {
		const e = endCommand();
		if (e !== null) return e;
		list.push({ joinedBy, stages });
		stages = [];
		joinedBy = next;
		return null;
	};

	let i = 0;
	const n = src.length;
	while (i < n) {
		const c = src[i]!;
		// ── quoting ──────────────────────────────────────────────────────
		if (c === "'") {
			const end = src.indexOf("'", i + 1);
			if (end < 0) return fail("an unterminated single quote");
			quotedFrom = Math.min(quotedFrom, word.length);
			word += src.slice(i + 1, end);
			inWord = true;
			wordQuoted = true;
			i = end + 1;
			continue;
		}
		if (c === '"') {
			quotedFrom = Math.min(quotedFrom, word.length);
			let j = i + 1;
			let closed = false;
			while (j < n) {
				const d = src[j]!;
				if (d === '"') {
					closed = true;
					break;
				}
				if (d === "$" || d === "`") return fail("an expansion inside double quotes");
				if (d === "\\" && j + 1 < n && '$`"\\\n'.includes(src[j + 1]!)) {
					if (src[j + 1] !== "\n") word += src[j + 1];
					j += 2;
					continue;
				}
				word += d;
				j += 1;
			}
			if (!closed) return fail("an unterminated double quote");
			inWord = true;
			wordQuoted = true;
			i = j + 1;
			continue;
		}
		if (c === "\\") {
			if (i + 1 >= n) return fail("a trailing backslash");
			if (src[i + 1] !== "\n") {
				quotedFrom = Math.min(quotedFrom, word.length);
				word += src[i + 1];
				inWord = true;
				wordQuoted = true;
			}
			i += 2;
			continue;
		}
		// ── what this reader refuses ─────────────────────────────────────
		if (c === "$" || c === "`") return fail("an expansion");
		if (c === "(" || c === ")") return fail("a subshell or grouping");
		if (c === "{" || c === "}") return fail("a brace");
		if (GLOB.has(c)) return fail("a glob");
		// A tilde expands at the start of a word and, in bash, after the `=`
		// or `:` of anything shaped like an assignment (`--prefix=~/x`). In
		// the middle of a word it is a character (`HEAD~3`).
		if (c === "~" && (!inWord || word.endsWith("=") || word.endsWith(":"))) return fail("a tilde");
		if (c === "#" && !inWord) return fail("a comment");
		// ── separators and operators ─────────────────────────────────────
		if (c === " " || c === "\t") {
			const e = endWord();
			if (e !== null) return fail(e);
			i += 1;
			continue;
		}
		if (c === "\n" || c === ";") {
			if (c === ";" && src[i + 1] === ";") return fail("a case terminator");
			const e = endWord() ?? endPipeline(";");
			if (e !== null) return fail(e);
			i += 1;
			continue;
		}
		if (c === "|") {
			if (src[i + 1] === "&") return fail("a |& pipe");
			const e = endWord();
			if (e !== null) return fail(e);
			if (src[i + 1] === "|") {
				const f = endPipeline("||");
				if (f !== null) return fail(f);
				i += 2;
				continue;
			}
			const f = endCommand();
			if (f !== null) return fail(f);
			i += 1;
			continue;
		}
		if (c === "&") {
			if (src[i + 1] === "&") {
				const e = endWord() ?? endPipeline("&&");
				if (e !== null) return fail(e);
				i += 2;
				continue;
			}
			if (src[i + 1] === ">" && !inWord) {
				if (src[i + 2] === ">") return fail("an appending &>> redirection");
				pending = { fd: "&", op: ">" };
				i += 2;
				continue;
			}
			return fail("a background job");
		}
		if (c === ">" || c === "<") {
			// A descriptor is the digits written immediately before, unquoted.
			let fd: Redirect["fd"] = null;
			if (inWord) {
				if (wordQuoted || !/^\d+$/.test(word)) return fail("a redirection glued to a word");
				fd = Number(word);
				word = "";
				inWord = false;
			}
			if (pending !== null) return fail("a redirection with no target");
			if (c === "<") {
				if (src[i + 1] === "<" || src[i + 1] === ">" || src[i + 1] === "&") return fail("a heredoc or descriptor duplication on input");
				pending = { fd, op: "<" };
				i += 1;
				continue;
			}
			if (src[i + 1] === ">") {
				pending = { fd, op: ">>" };
				i += 2;
				continue;
			}
			if (src[i + 1] === "&") {
				pending = { fd, op: ">&" };
				i += 2;
				continue;
			}
			if (src[i + 1] === "|") return fail("a clobbering redirection");
			pending = { fd, op: ">" };
			i += 1;
			continue;
		}
		word += c;
		inWord = true;
		i += 1;
	}
	const e = endWord();
	if (e !== null) return fail(e);
	// A trailing `;` or newline leaves an empty last command, which is not an
	// error in sh — `ls;` is `ls`. A trailing `|`, `&&`, `||` is.
	if (argv.length === 0 && redirects.length === 0 && pending === null && stages.length === 0 && joinedBy === ";" && list.length > 0) {
		return { ok: true, list };
	}
	const f = endPipeline(null);
	if (f !== null) return fail(f);
	return { ok: true, list };
}

/**
 * A path argument, resolved the way read_file resolves one: against the
 * directory the command runs in, with symlinks in the deepest EXISTING
 * ancestor followed, and the not-yet-existing tail re-appended. `inside`
 * is whether that canonical path is the workspace root or under it. One
 * resolver for every consumer — the read-only allow asks "inside?", the
 * floor asks "what is this?" — so the two can never disagree about where
 * a path goes.
 */
export interface ResolvedPath {
	readonly canonical: string;
	readonly inside: boolean;
}

/** A real path in the case the DISK holds it. The JS realpath keeps the
 *  case it was given, so on a case-insensitive disk `.ENV` stayed `.ENV`
 *  and walked past every name-based predicate (the lead's review, B2). */
export function realCase(p: string): string {
	try {
		return realpathSync.native(p);
	} catch {
		return p;
	}
}

export function resolveShellPath(workspaceRoot: string, cwd: string, word: string): ResolvedPath {
	// B1 (the lead's review): `..` is taken on the REAL path, one component
	// at a time — never collapsed as text first. `link-out/..` is the parent
	// of where link-out POINTS, which is where the shell goes; collapsed as
	// text it was the workspace, and `cat link-out/../etc/hosts` printed.
	let current = isAbsolute(word) ? "/" : realCase(cwd);
	// past the last component that exists, the rest is text: nothing on
	// disk can redirect a path that does not exist
	const missing: string[] = [];
	for (const part of word.split("/")) {
		if (part === "" || part === ".") continue;
		if (missing.length > 0) {
			if (part === "..") missing.pop();
			else missing.push(part);
			continue;
		}
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const next = join(current, part);
		if (existsSync(next)) current = realCase(next);
		else missing.push(part);
	}
	const canonical = missing.length > 0 ? join(current, ...missing) : current;
	const rel = relative(realCase(workspaceRoot), canonical);
	return { canonical, inside: rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) };
}
