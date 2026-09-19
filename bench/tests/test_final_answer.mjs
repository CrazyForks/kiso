// final-answer.mjs — the leg's final assistant text, per arm, from each
// arm's own record shape (the shapes of real legs: a kiso session log's
// events, a pi session file's messages). Run: node bench/tests/test_final_answer.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kisoFinalText, piFinalText } from "../final-answer.mjs";

const B = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (name, fn) => {
	fn();
	n += 1;
	console.log(`  ok   ${name}`);
};
const ev = (type, extra = {}) => ({ runId: "r", ts: 1, event: { type, ...extra } });

ok("kiso: the words after the final turn's last tool result, never the round before the tool", () => {
	const log = [
		ev("user_input", { content: "turn 1" }),
		ev("text_delta", { text: "old turn answer" }),
		ev("user_input", { content: "turn 2" }),
		ev("thinking", { text: "let me look" }),
		ev("text_delta", { text: "I will run the tests first." }),
		ev("tool_call_end", { callId: "c1", name: "shell" }),
		ev("tool_result", { callId: "c1", content: "ok" }),
		ev("thinking", { text: "they pass" }),
		ev("text_delta", { text: "All " }),
		ev("text_delta", { text: "green." }),
		ev("terminal", { outcome: { kind: "completed" } }),
	];
	assert.equal(kisoFinalText(log), "All green.");
});

ok("kiso: a final turn with no tool calls answers from its first word", () => {
	assert.equal(kisoFinalText([ev("user_input"), ev("text_delta", { text: "42" })]), "42");
});

ok("pi: the last assistant message with text parts; thinking and tool calls are not text", () => {
	const msgs = [
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "earlier" }] } },
		{ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Final " }, { type: "text", text: "answer." }] } },
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }] } },
		{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "tool output" }] } },
	];
	assert.equal(piFinalText(msgs), "Final answer.");
});

ok("an empty read is a FAILED read: the CLI exits 1 and writes no answer.txt", () => {
	const work = mkdtempSync(join(tmpdir(), "final-answer-"));
	mkdirSync(join(work, "kiso-home", "sessions"), { recursive: true });
	writeFileSync(join(work, "kiso-home", "sessions", "s.jsonl"), `${JSON.stringify(ev("user_input"))}\n${JSON.stringify(ev("thinking", { text: "only thought" }))}\n`);
	let code = 0;
	try {
		execFileSync(process.execPath, [join(B, "final-answer.mjs"), "kiso", work], { stdio: "pipe" });
	} catch (err) {
		code = err.status;
	}
	assert.equal(code, 1);
	assert.throws(() => readFileSync(join(work, "answer.txt")));
});

ok("the CLI writes UTF-8 with a trailing newline, from a pi session directory", () => {
	const work = mkdtempSync(join(tmpdir(), "final-answer-"));
	mkdirSync(join(work, "pi-session"));
	writeFileSync(join(work, "pi-session", "x.jsonl"), `${JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "réponse" }] } })}\n`);
	execFileSync(process.execPath, [join(B, "final-answer.mjs"), "pi", work]);
	assert.equal(readFileSync(join(work, "answer.txt"), "utf8"), "réponse\n");
});

console.log(`[final-answer] ${n} ok`);
