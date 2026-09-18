/**
 * 0.40.0 — the catastrophe floor: the corpus.
 *
 * The owner's line, 2026-09-17: bypass stays bypass — `rm -rf /tmp/probe`
 * RUNS — and the floor refuses only unrecoverable targets. Both halves are
 * pinned here: what is refused (and for the stated reason), and what must
 * still run, the owner's own case first.
 *
 * The home directory is a temporary one passed in, so nothing here depends
 * on — or could touch — the machine's own.
 */

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { KisoExtension } from "@vincemakes/kiso-runtime";
import { floorCheck, floorExtension, isDestructive, isDestructiveCall } from "../src/floor.js";
import { guardSavedAllow } from "../src/protected-writes.js";
import { ConfigError, parseConfig } from "../src/config.js";

let home = "";
let root = "";

beforeAll(() => {
	home = join(realpathSync(mkdtempSync(join(tmpdir(), "kiso-floor-"))), "home");
	root = join(home, "proj");
	mkdirSync(join(home, ".ssh"), { recursive: true });
	mkdirSync(join(home, ".config", "app"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "build"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	writeFileSync(join(home, ".ssh", "id_rsa"), "k");
	writeFileSync(join(root, "src", "a.ts"), "x");
	symlinkSync(home, join(root, "home-link"));
});

const check = (cmd: string) => floorCheck(cmd, root, home);

/** [command, a word the reason must contain] */
const REFUSED: readonly (readonly [string, string])[] = [
	["rm -rf /", "/"],
	["rm -rf /*", "a wildcard over /"],
	["rm -rf --no-preserve-root /", "/"],
	["rm -rf ~", "the home directory"],
	["rm -rf ~/", "the home directory"],
	["rm -rf ~/*", "a wildcard over the home directory"],
	["rm -rf ~/.*", "a wildcard over the home directory"],
	["rm -rf .", "the workspace root"],
	["rm -rf ./", "the workspace root"],
	["rm -rf *", "a wildcard over the workspace root"],
	["rm -rf .*", "a wildcard over the workspace root"],
	["rm -rf ..", "the home directory"],
	["rm -rf ../..", "above the workspace"],
	["rm -rf /usr", "a system root (/usr)"],
	["rm -rf /etc", "a system root (/etc)"],
	["rm -rf /tmp", "a system root"],
	["rm -rf home-link/", "the home directory"],
	// only a variable: empty, it is the root of whatever follows
	["rm -rf $DIR/", "only a variable"],
	['rm -rf "$HOME"', "only a variable"],
	['rm -rf "${X}"/*', "only a variable"],
	["rm -rf ~/$X", "a wildcard over the home directory"],
	// the well-known home subtrees, and anything inside them
	["rm -rf ~/.ssh", "~/.ssh"],
	["rm ~/.ssh/id_rsa", "~/.ssh"],
	["rm -rf ~/.config/app", "~/.config"],
	["rm -rf ~/.kiso", "~/.kiso"],
	// through wrappers and nested command lines
	["sudo rm -rf /", "/"],
	["sudo -u root rm -rf /", "/"],
	["env A=1 rm -rf ~", "the home directory"],
	["command rm -rf ~", "the home directory"],
	["bash -c 'rm -rf ~'", "the home directory"],
	['sh -lc "rm -rf /"', "/"],
	["eval rm -rf ~", "the home directory"],
	["echo $(rm -rf ~)", "the home directory"],
	["echo `rm -rf ~`", "the home directory"],
	["true && (rm -rf ~)", "the home directory"],
	["ls; rm -rf ~ 2>/dev/null", "the home directory"],
	// a cd moves the target
	["cd / && rm -rf *", "a wildcard over /"],
	["cd ~ && rm -rf .ssh", "~/.ssh"],
	["cd .. && rm -rf proj", "the workspace root"],
	// `||` runs only if the cd FAILED — where it was; `;` either way
	["cd build || rm -rf *", "a wildcard over the workspace root"],
	["cd build; rm -rf *", "a wildcard over the workspace root"],
	["cd && rm -rf *", "the home directory"],
	['cd "$X" && rm -rf *', "the home directory"],
	// the other destructive commands
	["find / -delete", "/"],
	["find . -name '*.log' -delete", "the workspace root"],
	["find ~ -name x -delete", "the home directory"],
	["git clean -fdx", "the workspace root"],
	["git clean -f", "the workspace root"],
	["git clean --force -d", "the workspace root"],
	["git -C .. clean -fd", "the home directory"],
	["git reset --hard", "the workspace root"],
	["git reset --hard HEAD~1", "the workspace root"],
	["git checkout -- .", "the workspace root"],
];

const RUNS: readonly string[] = [
	"rm -rf /tmp/probe", // the owner's own case
	"sudo rm -rf /tmp/probe",
	"rm -rf node_modules",
	"rm -rf build/*",
	"rm -rf build",
	"rm src/a.ts",
	"rm -rf foo*",
	"rm -rf $X/build",
	"rm -rf ~/projects/old",
	"find build -name '*.o' -delete",
	"git clean -fd build/",
	"git clean -n",
	"git reset --soft HEAD~1",
	"git reset HEAD src/a.ts",
	"git checkout main",
	"git checkout -- src/a.ts",
	"ls -la / ~ ~/.ssh",
	"cat ~/.ssh/config",
	"echo rm -rf ~",
	"echo 'rm -rf /'",
	"cd build && rm -rf *",
	"cd build && rm -rf * && ls",
	"npm test",
];

describe("the floor refuses the unrecoverable, and says which", () => {
	for (const [cmd, why] of REFUSED) {
		it(JSON.stringify(cmd), () => {
			const v = check(cmd);
			expect(v.refused, cmd).toBe(true);
			expect(v.refused ? v.why : "", cmd).toContain(why);
		});
	}
});

describe("and nothing else — bypass stays bypass", () => {
	for (const cmd of RUNS) {
		it(JSON.stringify(cmd), () => {
			expect(check(cmd)).toEqual({ refused: false });
		});
	}
});

describe("destructive, whatever the target — what a saved allow never carries", () => {
	it("names the destructive commands and nothing else", () => {
		for (const cmd of ["rm x", "rm -rf build", "bash -c 'rm x'", "git clean -fd build", "git reset --hard", "git checkout -- a", "find . -delete", "sudo rm x"]) {
			expect(isDestructive(cmd), cmd).toBe(true);
		}
		for (const cmd of ["ls", "git status", "git clean -n", "git reset --soft HEAD~1", "git checkout main", "find . -name x", "echo rm -rf ~", "npm test"]) {
			expect(isDestructive(cmd), cmd).toBe(false);
		}
	});

	it("the saved allow abstains for a destructive shell call, and allows the rest as before", async () => {
		const rules = new Set(["shell"]);
		const saved = {
			name: "dont-ask-again",
			rules,
			approvals: [{ decide: (call: { name: string }) => (rules.has(call.name) ? { action: "allow" as const } : { action: "abstain" as const }) }],
		} as unknown as KisoExtension & { rules: Set<string> };
		const guarded = guardSavedAllow(saved, isDestructiveCall) as KisoExtension & { rules: Set<string> };
		const decide = (command: string) => guarded.approvals![0]!.decide({ name: "shell", input: { command } }, {} as never);
		expect(await decide("rm -rf build")).toEqual({ action: "abstain" });
		expect(await decide("npm test")).toEqual({ action: "allow" });
		// the live handle the grant path mutates is the same object
		expect(guarded.rules).toBe(rules);
		// any other extension passes through untouched
		const other = { name: "safe-test", approvals: [] } as KisoExtension;
		expect(guardSavedAllow(other, isDestructiveCall)).toBe(other);
	});
});

describe("the chain member", () => {
	const decide = (on: boolean, name: string, command: string) =>
		floorExtension(() => on, () => root).approvals![0]!.decide({ name, input: { command } }, {} as never);

	it("denies a catastrophe with the reason the model sees, and abstains otherwise", async () => {
		const v = (await decide(true, "shell", "rm -rf /")) as { action: string; reason?: string };
		expect(v.action).toBe("deny");
		expect(v.reason).toContain("the floor refused this");
		expect(await decide(true, "shell", "rm -rf /tmp/probe")).toEqual({ action: "abstain" });
		expect(await decide(true, "write_file", "rm -rf /")).toEqual({ action: "abstain" });
	});

	it("switched off, it says nothing at all", async () => {
		expect(await decide(false, "shell", "rm -rf /")).toEqual({ action: "abstain" });
	});
});

describe("the switch — the USER's alone", () => {
	it("`floor` is catastrophe or off in the user config", () => {
		expect(parseConfig(JSON.stringify({ floor: "off" }), "~/.kiso/config.json").floor).toBe("off");
		expect(parseConfig(JSON.stringify({ floor: "catastrophe" }), "~/.kiso/config.json").floor).toBe("catastrophe");
		expect(() => parseConfig(JSON.stringify({ floor: "none" }), "~/.kiso/config.json")).toThrow(ConfigError);
	});

	it("a PROJECT config naming it fails loudly — a repository must never lower the floor", () => {
		expect(() => parseConfig(JSON.stringify({ floor: "off" }), "<cwd>/.kiso/config.json")).toThrow(/belongs in the USER config/);
	});
});

describe("B6 — the reader cannot be knocked out, and a knocked-out read denies (the lead's review)", () => {
	const member = (check?: Parameters<typeof floorExtension>[2]) =>
		floorExtension(() => true, () => root, check).approvals![0]!;

	it("a 9 KB `$(` nest is DENIED, in under 10 ms — it used to throw, degrade to ask, and lose to bypass's allow", async () => {
		const command = `rm -rf ${"$(".repeat(4_500)}`;
		expect(command.length).toBeGreaterThan(9_000);
		// warmed once with an ordinary line: the timing is the NEST's cost, not
		// the one-time resolution of the roots (memoized per workspace)
		await member().decide({ name: "shell", input: { command: "ls" } }, {} as never);
		const t0 = performance.now();
		const v = (await member().decide({ name: "shell", input: { command } }, {} as never)) as { action: string };
		const ms = performance.now() - t0;
		expect(v.action).toBe("deny");
		expect(ms, `${ms.toFixed(1)} ms`).toBeLessThan(10);
	});

	it("400 `;`-joined cds are judged in under a second — the candidate set is bounded", () => {
		const cds = Array.from({ length: 200 }, () => "cd src; cd build").join("; ");
		const t0 = performance.now();
		const runs = check(`${cds}; rm -rf node_modules`);
		const refused = check(`${cds}; rm -rf *`);
		const ms = performance.now() - t0;
		expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(1_000);
		expect(runs.refused).toBe(false);
		// collapsed to {newest, home, workspace root}: a wildcard is still judged against both
		expect(refused.refused).toBe(true);
	});

	it("a read that throws is a DENY, never an ask for bypass to outvote", async () => {
		const v = (await member(() => {
			throw new RangeError("Maximum call stack size exceeded");
		}).decide({ name: "shell", input: { command: "anything" } }, {} as never)) as { action: string; reason?: string };
		expect(v.action).toBe("deny");
		expect(v.reason).toContain("could not read this line");
	});
});
