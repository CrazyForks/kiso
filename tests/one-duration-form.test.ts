/**
 * One duration form, swept — the gate that makes the sweep checkable.
 *
 * The 0.39.0 item's spec was "one helper, every site, a card and the
 * status row never disagree". The helper landed; the sweep did not. Two
 * call sites were converted (the running card's tiers) and seven were
 * not, including `packages/tui/src/status.ts` — the exact row that
 * started the item, still saying `working 637s`.
 *
 * HOW THE MISS HAPPENED, so the gate is aimed at it: the converted sites
 * were the ones in the diff I was already writing, and they held the
 * duration in a local called `elapsed`. The sites I did not reach were in
 * OTHER functions — the settled-card ladders and a status row in another
 * package, one of them holding the duration in a local called `seconds`.
 * Nothing went red, because writing `${elapsed}s` is not an error; it is
 * only an inconsistency, and an inconsistency has no natural oracle. This
 * file is that oracle: it is a property of the TREE, not of a function,
 * so it cannot be satisfied halfway.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** SOURCE only. A test may quote the old shape to say what it was — the
 *  rule is about what a SURFACE emits, and that is what these roots are. */
const ROOTS = ["packages/tui/src", "packages/tui-cells/src", "apps/cli/src"];

/** `${elapsed}s`, `${seconds}s`, and anything named like them — a
 *  duration interpolated raw and suffixed with a bare `s`. The helper's
 *  own internals (`${s}s`, `${m}m ${s % 60}s`) are not this shape. */
const RAW_SECONDS = /\$\{\s*\w*(?:elapsed|seconds|secs)\w*\s*\}s(?![a-z])/i;


function walk(dir: string, out: string[]): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out; // a root that does not exist in this checkout is not a failure
	}
	for (const name of entries) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (extname(full) === ".ts") out.push(full);
	}
	return out;
}

describe("one duration form", () => {
	it("no surface writes a raw `${seconds}s` — every live duration goes through elapsedLabel", () => {
		const offenders: string[] = [];
		for (const r of ROOTS) {
			for (const file of walk(join(ROOT, r), [])) {
				const lines = readFileSync(file, "utf8").split("\n");
				lines.forEach((line, i) => {
					const rel = relative(ROOT, file).split("\\").join("/");
					if (RAW_SECONDS.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
				});
			}
		}
		expect(offenders, `raw second-suffixed durations still on a surface:\n${offenders.join("\n")}`).toEqual([]);
	});
});
