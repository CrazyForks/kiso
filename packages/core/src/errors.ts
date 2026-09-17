/**
 * Shared API-error → StructuredError mapping for both adapters.
 *
 * Classification by status code, never by regex over message text
 * (ADR-0005). 529 is the Cloudflare overload code most OpenAI-compat
 * providers proxy raw.
 */

import type { StructuredError } from "./protocol/events.js";

/** CX-1 F8: `Retry-After` → milliseconds. Integer seconds or an HTTP-date;
 *  anything else — negative, non-finite, a date already past — is
 *  undefined (the kernel falls back to its own backoff). Never shortened:
 *  a wait above the kernel's cap is reported as-is and the kernel stops
 *  rather than retrying early. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
	if (value === null || value === undefined) return undefined;
	const v = value.trim();
	if (v === "") return undefined;
	if (/^\d+$/.test(v)) {
		const ms = Number(v) * 1000;
		return Number.isFinite(ms) ? ms : undefined;
	}
	const at = Date.parse(v);
	if (!Number.isFinite(at)) return undefined;
	const ms = at - now;
	return ms >= 0 ? ms : undefined;
}

export function mapApiError(status: number | undefined, message: string, retryAfterMs?: number): StructuredError {
	const withStatus = (e: Omit<StructuredError, "status">): StructuredError => ({
		...e,
		...(status !== undefined ? { status } : {}),
		...(retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? { retryAfterMs } : {}),
	});

	switch (status) {
		case 401:
		case 403:
			return withStatus({ code: "invalid_request", retryable: false, message });
		case 408:
		case 409:
		case 429:
			return withStatus({ code: "rate_limit", retryable: true, message });
		case 529:
			return withStatus({ code: "overloaded", retryable: true, message });
		case 400:
			return withStatus({ code: "invalid_request", retryable: false, message });
		default:
			if (status !== undefined && status >= 500 && status < 600) {
				// D4: every 500-599 is api_5xx and retryable.
				return withStatus({ code: "api_5xx", retryable: true, message });
			}
			return withStatus({ code: "unknown", retryable: false, message });
	}
}

/**
 * A failure that reached us AFTER the response headers did.
 *
 * Once a 2xx and the headers are in, the request has been ACCEPTED: no
 * later failure is a verdict on whether it was valid, because nothing was
 * left to validate. What remains is the server or the transport failing
 * mid-flight — a dead socket, a body cut by an intermediary, an in-band
 * error frame, a stream that simply ends without the terminal event its
 * protocol mandates. Every one of those is `network` and RETRYABLE, so
 * the kernel's mid-stream recovery (ADR-0005: retry lives in the kernel;
 * F4: void the draft durably, then retry) engages instead of ending the
 * run on a verdict nobody issued.
 *
 * Deliberately broader than what can be proven transient: a permanent
 * fault misclassified here costs `maxRetries` extra requests (2 by
 * default) and then ends in the same terminal it would have anyway,
 * while a transient one misclassified the other way costs the whole
 * session. The asymmetry is the argument.
 *
 * An error the provider states BEFORE the stream keeps its status
 * mapping — `mapApiError` is untouched and stays the authority there.
 */
export function streamFailure(message: string): StructuredError {
	return { code: "network", retryable: true, message };
}
