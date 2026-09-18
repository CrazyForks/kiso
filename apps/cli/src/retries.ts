/**
 * ADR-0005 Amendment 2: KISO_MAX_RETRIES overrides the kernel's default
 * budget, CLAMPED to 15 — a typo must not turn one failing request into an
 * hour of retries at 32 s apiece. The kernel reads no environment; this is
 * the front door's knob, passed in as `maxRetries`. Absent or unreadable
 * means the kernel's own default.
 */
export const MAX_RETRIES_CLAMP = 15;

export function maxRetriesFromEnv(raw: string | undefined = process.env.KISO_MAX_RETRIES): number | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) return undefined;
	return Math.min(n, MAX_RETRIES_CLAMP);
}
