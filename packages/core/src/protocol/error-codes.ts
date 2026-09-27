/**
 * The durable protocol's error codes — ONE set, shared by the validator
 * (isKisoEvent) and the kernel's normalizer (toStructuredError), so the
 * kernel can never write a terminal the store will not read back.
 *
 * INTERNAL: not re-exported from `protocol/index.ts` or the package root,
 * on purpose — a host must not be able to see, let alone mutate, the
 * whitelist the two sides agree on. The public type is `ErrorCode`.
 */
import type { ErrorCode } from "./events.js";

export const ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
	"rate_limit",
	"overloaded",
	"network",
	"timeout",
	"quota",
	"api_5xx",
	"context_overflow",
	"invalid_request",
	"unknown",
]);
