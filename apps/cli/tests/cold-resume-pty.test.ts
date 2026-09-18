/**
 * 0.40.0 item 9 — the cold resume, in a real PTY.
 *
 * A session whose last bill put it over the microcompact threshold, billed
 * 30 minutes ago, is resumed: the panel names its size and age, ⏎
 * compacts BEFORE any request, `n` leaves it whole, dontAsk compacts
 * without asking, and a session billed a minute ago is not offered at all.
 * The faux model's window is the 200k fallback, so its threshold is 100k
 * and a 150k bill is over it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isolatedEnv } from "../../../tests/helpers/isolated-cli.mjs";

const CLI = join(fileURLToPath(new URL("..", import.meta.url)), "dist", "index.js");

/** Keys fed when their needle appears; stop once every feed is sent and
 *  every settle needle is on screen, after a grace window for the writes. */
const PTY_DRIVER = `
import pty, os, sys, time, select, signal, struct, fcntl, termios

def driver(cli, argv, env, feeds, timeout, settle, grace):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(env)
        os.execvp("node", ["node", cli] + argv)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    full = b""
    fed = set()
    end = time.time() + timeout
    settled = None
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                data = os.read(fd, 4096)
            except OSError:
                break
            if not data:
                break
            full += data
        for i, (needle, text) in enumerate(feeds):
            if i not in fed and needle.encode() in full:
                os.write(fd, text.encode())
                fed.add(i)
        if settled is None and len(fed) == len(feeds) and all(s.encode() in full for s in settle):
            settled = time.time()
        if settled is not None and time.time() - settled >= grace:
            break
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass
    sys.stdout.write(full.hex())
`;

function pty(env: NodeJS.ProcessEnv, argv: string[], feeds: [string, string][], settle: string[], grace = 2): string {
	const dir = mkdtempSync(join(tmpdir(), "kiso-cold-pty-"));
	const driverPath = join(dir, "driver.py");
	writeFileSync(driverPath, PTY_DRIVER, "utf8");
	const phase = `
exec(open(${JSON.stringify(driverPath)}).read())
driver(${JSON.stringify(CLI)}, ${JSON.stringify(argv)}, ${JSON.stringify(env)}, ${JSON.stringify(feeds)}, 25, ${JSON.stringify(settle)}, ${grace})
`;
	const out = execFileSync("python3", ["-c", phase], { encoding: "utf8", timeout: 45_000, env: process.env });
	return Buffer.from(out, "hex").toString("utf8").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

/** Six finished rounds, the last one billed at 150k, every record stamped
 *  `minutesAgo` in the past — the durable file a resume opens. */
function seed(home: string, id: string, minutesAgo: number): void {
	const ts = Date.now() - minutesAgo * 60_000;
	const lines: string[] = [];
	let seq = 0;
	for (let i = 0; i < 6; i++) {
		const rec = (event: Record<string, unknown>) => lines.push(JSON.stringify({ runId: `run-${i}`, ts, event: { ...event, seq: seq++ } }));
		rec({ type: "user_input", content: `round ${i}: ${"words ".repeat(40)}` });
		rec({ type: "text_delta", text: `answer ${i}` });
		if (i === 5) rec({ type: "usage", inputTokens: 150_000, outputTokens: 900, cacheRead: 149_000, cacheWrite: null, known: true });
		rec({ type: "stop", reason: "end_turn" });
		rec({ type: "terminal", outcome: { kind: "completed" } });
	}
	mkdirSync(join(home, "sessions"), { recursive: true });
	writeFileSync(join(home, "sessions", `${id}.jsonl`), `${lines.join("\n")}\n`);
}

const VALID_SUMMARY = ["## Goal", "g", "## Constraints", "c", "## User requests", "u", "## Files and changes", "f", "## Errors and fixes", "none", "## Current work", "w", "## Next steps", "n"].join("\n");

/** The faux script resumes at its durable position (six finished rounds):
 *  six spent entries, then the summary call's answer. */
function script(dir: string): string {
	const say = (text: string) => ({ events: [{ type: "text_delta", text }, { type: "stop", reason: "end_turn" }] });
	const p = join(dir, "faux.json");
	writeFileSync(p, JSON.stringify([...Array.from({ length: 6 }, () => say("spent")), say(VALID_SUMMARY)]), "utf8");
	return p;
}

const kinds = (home: string, id: string): string[] =>
	readFileSync(join(home, "sessions", `${id}.jsonl`), "utf8")
		.split("\n")
		.filter((l) => l.trim() !== "")
		.map((l) => String((JSON.parse(l) as { event: { type: string } }).event.type));

describe("0.40.0 — a resumed session whose cache has gone cold is offered a compaction first", () => {
	it("⏎ compacts before any request; the panel names the size and the age", () => {
		const { env, dirs } = isolatedEnv();
		seed(dirs.home, "cold", 30);
		const screen = pty({ ...env, KISO_FAUX_SCRIPT: script(dirs.home) }, ["chat", "cold"], [["cache is cold", "\r"]], ["✦ compacted"]);
		expect(screen.replace(/\s+/g, " ")).toContain("this session is 151k tokens, last used 30 min ago, and its cache is cold");
		const k = kinds(dirs.home, "cold");
		expect(k).toContain("summarized");
		expect(k.filter((t) => t === "user_input")).toHaveLength(6); // no new turn was sent
	}, 60_000);

	it("n keeps the full history — nothing is summarized", () => {
		const { env, dirs } = isolatedEnv();
		seed(dirs.home, "keep", 30);
		pty({ ...env, KISO_FAUX_SCRIPT: script(dirs.home) }, ["chat", "keep"], [["cache is cold", "n"]], ["cache is cold"], 3);
		expect(kinds(dirs.home, "keep")).not.toContain("summarized");
	}, 60_000);

	it("dontAsk compacts without a panel — it is not an approval", () => {
		const { env, dirs } = isolatedEnv();
		seed(dirs.home, "unattended", 30);
		const screen = pty({ ...env, KISO_FAUX_SCRIPT: script(dirs.home), KISO_MODE: "dontAsk" }, ["chat", "unattended"], [], ["✦ compacted"]);
		expect(screen.replace(/\s+/g, " ")).toContain("[dontAsk] this session is 151k tokens");
		expect(screen).not.toContain("keep the full history");
		expect(kinds(dirs.home, "unattended")).toContain("summarized");
	}, 60_000);

	it("a session billed a minute ago is warm — no offer", () => {
		const { env, dirs } = isolatedEnv();
		seed(dirs.home, "warm", 1);
		const screen = pty({ ...env, KISO_FAUX_SCRIPT: script(dirs.home) }, ["chat", "warm"], [], ["/ commands"], 3);
		expect(screen).not.toContain("cache is cold");
		expect(kinds(dirs.home, "warm")).not.toContain("summarized");
	}, 60_000);
});
