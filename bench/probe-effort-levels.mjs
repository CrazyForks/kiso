#!/usr/bin/env node
/**
 * WHAT LEVELS DOES THE SERVER ACTUALLY ACCEPT — asked of the API, not of a
 * document and not of our own registry.
 *
 * The registry recorded deepseek-v4-flash as low/high/max, dated and sourced
 * from the vendor's thinking-mode guide. The server accepts SEVEN, and says
 * so itself: sending a value it does not know returns
 *
 *   400  reasoning_effort: unknown variant `banana`, expected one of
 *        `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`
 *
 * That error is the evidence. The field is deserialized into a typed enum
 * before anything else happens, so a rejection NAMES the legal set — which
 * makes the question answerable in one request that generates no tokens,
 * rather than by reading prose that was true on some date.
 *
 * Why it matters beyond tidiness: a comparison between products at
 * different reasoning levels compares settings, not products. Aligning the
 * levels needs the real sets, and a set we copied out of documentation is
 * not one we have checked.
 *
 *   node bench/probe-effort-levels.mjs <base-url> <model> <api-key-env>
 */
import { isMain } from "../scripts/is-main.mjs";

const SENTINEL = "kiso-probe-not-a-level";

export async function probeLevels(baseUrl, model, key) {
	const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
		// max_tokens 1 and a one-word prompt: the request is REFUSED before
		// generation, so this costs nothing even when a server accepts it.
		body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }], reasoning_effort: SENTINEL }),
	});
	const body = await res.json().catch(() => ({}));
	const message = body?.error?.message ?? "";
	if (res.status === 200) {
		return { status: res.status, levels: null, why: "the server ACCEPTED a nonsense level — it does not validate this field, so its legal set cannot be read this way" };
	}
	// `expected one of \`a\`, \`b\`, ...` — the shape every serde enum error takes.
	const listed = [...message.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).filter((v) => v !== SENTINEL);
	if (listed.length === 0) {
		return { status: res.status, levels: null, why: `refused, but named no set: ${message.slice(0, 160)}` };
	}
	return { status: res.status, levels: listed, why: null, raw: message.slice(0, 200) };
}

if (isMain(import.meta.url)) {
	const [baseUrl, model, keyEnv] = process.argv.slice(2);
	if (baseUrl === undefined || model === undefined || keyEnv === undefined) {
		console.error("usage: probe-effort-levels.mjs <base-url> <model> <api-key-env>");
		process.exit(2);
	}
	const key = process.env[keyEnv];
	if (!key) { console.error(`${keyEnv} is not set`); process.exit(2); }
	console.log(JSON.stringify(await probeLevels(baseUrl, model, key), null, 1));
}
