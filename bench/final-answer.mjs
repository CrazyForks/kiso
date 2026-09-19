/**
 * A leg's FINAL assistant text, read from the arm's own durable record —
 * what family E's verifier reads as `answer.txt` (the concealed README:
 * UTF-8, no BOM, a trailing newline, written for every leg).
 *
 * The final text is the LAST model round's text: after the final turn's
 * last tool result, the words the model ended on. A round that explains
 * itself and then calls a tool is not the answer; the round after the tool
 * is. Thinking is never the answer.
 *
 *   kiso   <work>/kiso-home/sessions/<id>.jsonl — the one session log (not
 *          traces/, not a delegated child): `text_delta` events after the
 *          last `user_input`, from the last `tool_result` on.
 *   pi     <work>/pi-session — its session directory (or file): the last
 *          `message` whose role is assistant and which carries text parts.
 *
 * An EMPTY read is a failed read, not an empty answer (the lead's pilot
 * condition 4): the CLI exits 1 and writes nothing, and the runner records
 * the leg as `answer_unread`.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function jsonl(path) {
	const out = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// a torn last line — the record up to it stands
		}
	}
	return out;
}

/** kiso: the final round's text from one session log's records. */
export function kisoFinalText(records) {
	const events = records.map((r) => r.event ?? r);
	let from = -1;
	for (let i = events.length - 1; i >= 0; i--) {
		if (events[i].type === "user_input") {
			from = i;
			break;
		}
	}
	if (from === -1) return "";
	let start = from;
	for (let i = from + 1; i < events.length; i++) if (events[i].type === "tool_result") start = i;
	let text = "";
	for (let i = start + 1; i < events.length; i++) if (events[i].type === "text_delta") text += events[i].text ?? "";
	return text.trim();
}

/** pi: the last assistant message's text parts. */
export function piFinalText(records) {
	for (let i = records.length - 1; i >= 0; i--) {
		const m = records[i].type === "message" ? records[i].message : null;
		if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
		const text = m.content
			.filter((p) => p?.type === "text" && typeof p.text === "string")
			.map((p) => p.text)
			.join("")
			.trim();
		if (text !== "") return text;
	}
	return "";
}

function kisoLog(work) {
	const dir = join(work, "kiso-home", "sessions");
	const logs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.startsWith("sub-")) : [];
	if (logs.length !== 1) throw new Error(`expected one kiso session log in ${dir}, found ${logs.length}`);
	return join(dir, logs[0]);
}

function piLog(work) {
	const p = join(work, "pi-session");
	if (!existsSync(p)) throw new Error(`no pi session at ${p}`);
	if (!statSync(p).isDirectory()) return p;
	const files = readdirSync(p).filter((f) => f.endsWith(".jsonl"));
	if (files.length !== 1) throw new Error(`expected one pi session file in ${p}, found ${files.length}`);
	return join(p, files[0]);
}

export function finalAnswer(tool, work) {
	if (tool === "kiso") return kisoFinalText(jsonl(kisoLog(work)));
	if (tool === "pi") return piFinalText(jsonl(piLog(work)));
	throw new Error(`no final-answer reader for ${tool}`);
}

// CLI: node final-answer.mjs <tool> <work> — writes <work>/answer.txt
if (import.meta.url === `file://${process.argv[1]}`) {
	const [tool, work] = process.argv.slice(2);
	let text = "";
	try {
		text = finalAnswer(tool, work);
	} catch (err) {
		process.stderr.write(`final-answer: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	}
	if (text === "") {
		process.stderr.write("final-answer: the record holds no final text — a failed read, not an empty answer\n");
		process.exit(1);
	}
	writeFileSync(join(work, "answer.txt"), `${text}\n`, "utf8");
}
