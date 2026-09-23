/**
 * CW-1 batch 2 — a route's real window, read from its own refusal.
 *
 * Batch 1 gives a registered model a window at any endpoint, and at an
 * endpoint no row names that window is the model's — a vendor statement
 * about the weights, which a relay may cap lower. The one source that is
 * right for ANY route is the route itself, and a route that refuses an
 * oversize request usually states its cap. d4fc (2026-09-22) died on:
 *
 *   This model's maximum context length is 1048576 tokens. However, you
 *   requested 131072 output tokens and your prompt contains at least
 *   917505 input tokens ...
 *
 * The kernel already compacts once and retries once on context_overflow;
 * what it lacked is the figure, so the compaction and every request after
 * it aimed at the wrong window. This wrapper reads the figure off the
 * refusal and hands it on, then rethrows the error untouched — it changes
 * no classification and no retry.
 */
import type { Adapter, AdapterEvent, StreamOptions } from "@vincemakes/kiso-core";

/** The two wordings the providers kiso speaks to use for the cap:
 *  OpenAI-shaped and vLLM-shaped servers (and gateways in front of them)
 *  say `maximum context length is N tokens`; Anthropic-shaped ones say
 *  `prompt is too long: A tokens > N maximum`. */
const CAP_PATTERNS: readonly RegExp[] = [/maximum context length is\s+(\d[\d,_]*)\s*tokens/i, /prompt is too long:\s*\d[\d,_]*\s*tokens\s*>\s*(\d[\d,_]*)\s*maximum/i];

/** A window below this, or above the second bound, is not a window a
 *  refusal would state — a figure outside them is a misread, never a cap. */
const MIN_CAP = 1_000;
const MAX_CAP = 100_000_000;

/** The cap a refusal states, or null — anything that does not say one in
 *  the two wordings above is null, never a guess. */
export function overflowCap(message: string): number | null {
	for (const re of CAP_PATTERNS) {
		const m = re.exec(message);
		if (m === null) continue;
		const n = Number(m[1]!.replace(/[,_]/g, ""));
		return Number.isSafeInteger(n) && n >= MIN_CAP && n <= MAX_CAP ? n : null;
	}
	return null;
}

/** Wraps an adapter so a refusal that states a cap is reported once, and
 *  then thrown on exactly as it came. A caller's abort passes untouched. */
export function windowLearner(adapter: Adapter, onCap: (tokens: number) => void): Adapter {
	return { stream: (options: StreamOptions) => learning(adapter, options, onCap) };
}

async function* learning(adapter: Adapter, options: StreamOptions, onCap: (tokens: number) => void): AsyncIterable<AdapterEvent> {
	try {
		yield* adapter.stream(options);
	} catch (err) {
		if (options.signal?.aborted !== true) {
			const message = typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : null;
			const cap = message === null ? null : overflowCap(message);
			if (cap !== null) onCap(cap);
		}
		throw err;
	}
}
