/**
 * ADR-0055 Amendment 2 (decision 3) — the overflow belt: a runtime adapter
 * wrapper, beside the idle and truncation guards.
 *
 * WHY: d7aa's last request carried an anchored 1,047,981 tokens to a model
 * whose window is 1,048,576. The gateway answered `500 Internal server
 * error` — no text a classifier could read — and the kernel, told a 5xx is
 * retryable, re-sent a request that could not fit ten times: the twelve-
 * minute freeze. kiso already KNEW the request could not fit. This belt
 * says so: when a request is sent with the anchored context at or above
 * the stated window minus the output reserve, any provider error it meets
 * is `context_overflow`, not retryable, and the kernel's one compaction and
 * one retry take over.
 *
 * It is a belt, not the cure — the cure is that the context never gets
 * there (decisions 1, 2 and 4). Below the limit nothing changes: a bare
 * 5xx keeps its retries. The limit is measured ONCE, at send time, from a
 * STATED window only; the caller's `measure` returns null when no window is
 * stated (the 200K policy fallback never arms it — keyed on the fallback, a
 * session at 170K on a real 1M model would lose its retries to every
 * transient 5xx) or when no bill anchors the context.
 *
 * A caller's abort passes through untouched: it is not the provider's error.
 */
import type { Adapter, AdapterEvent, StreamOptions, StructuredError } from "@vincemakes/kiso-core";

export interface OverflowMeasure {
	/** The anchored context the request carries (the last bill + what was appended since). */
	readonly used: number;
	/** The stated window. */
	readonly window: number;
	/** The output the endpoint may grant (compaction-policy.ts outputReserve). */
	readonly reserve: number;
}

export function overflowBelt(adapter: Adapter, measure: () => OverflowMeasure | null): Adapter {
	return {
		stream: (options: StreamOptions) => {
			const m = measure();
			if (m === null || m.used < m.window - m.reserve) return adapter.stream(options);
			return belted(adapter, options, m);
		},
	};
}

async function* belted(adapter: Adapter, options: StreamOptions, m: OverflowMeasure): AsyncIterable<AdapterEvent> {
	try {
		yield* adapter.stream(options);
	} catch (err) {
		if (options.signal?.aborted === true || !isStructured(err)) throw err;
		throw {
			...err,
			code: "context_overflow",
			retryable: false,
			message: `${err.message} — the request carried ~${m.used} tokens against a stated ${m.window}-token window less a ${m.reserve}-token output reserve; it could not fit, so it is not retried`,
		} satisfies StructuredError;
	}
}

function isStructured(err: unknown): err is StructuredError {
	return err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" && typeof (err as { message?: unknown }).message === "string";
}
