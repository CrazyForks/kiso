import type { Event } from "@vincemakes/kiso-core";
import { DURABLE_TO_WIRE, SANITIZED_FIELDS, WIRE_FIELDS, type WireEvent, type WireEventType } from "@vincemakes/kiso-protocol";

/**
 * The projection: durable Event → WireEvent | null.
 *
 * Pure, total over the union: a type not in DURABLE_TO_WIRE yields null; a
 * type on the wire yields exactly the allowlisted fields that are present
 * (never undefined), with tool arguments passed through `sanitize`. The
 * allowlist is data in the protocol package; nothing here can add a field
 * the protocol did not name.
 */

export interface ProjectionOptions {
	/** Reasoning text on the wire — OFF unless a product asks (every hosting
	 *  product shipped a "thinking leaks" fix once). */
	readonly exposeThinking?: boolean;
	/** Replaces the default tool-argument sanitizer. */
	readonly sanitize?: (input: unknown) => unknown;
}

/** Argument keys that carry prose the client has no business seeing in a
 *  tool card (the model's own prompt to a generator, a document body).
 *  uooki's list, verbatim. */
export const STRIPPED_ARG_KEYS: ReadonlySet<string> = new Set(["prompt", "description", "text", "body", "content", "instructions", "system_prompt", "input_text"]);

/** Longer string values are cut here; the card shows a prefix. */
export const MAX_ARG_VALUE_CHARS = 200;

/** Nesting beyond this is replaced by a marker rather than walked. */
export const MAX_ARG_DEPTH = 8;

/** The default sanitizer: drops the prose keys and truncates long strings
 *  AT EVERY DEPTH — objects and arrays are walked (0.41.1; the 0.41.0
 *  version was shallow, so `{ options: { prompt } }` passed the prompt
 *  through). What it is: a UI-noise and casual-leak filter for a tool
 *  card. What it is not: a privacy boundary — a product that must
 *  guarantee no prose reaches a client supplies its own `sanitize`. */
export function sanitizeToolArgs(input: unknown, depth = 0): unknown {
	if (typeof input === "string") return input.length > MAX_ARG_VALUE_CHARS ? `${input.slice(0, MAX_ARG_VALUE_CHARS)}…` : input;
	if (input === null || typeof input !== "object") return input;
	if (depth >= MAX_ARG_DEPTH) return Array.isArray(input) ? "[…]" : "{…}";
	if (Array.isArray(input)) return input.map((v) => sanitizeToolArgs(v, depth + 1));
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (STRIPPED_ARG_KEYS.has(key)) continue;
		out[key] = sanitizeToolArgs(value, depth + 1);
	}
	return out;
}

export function toWireEvent(event: Event, options: ProjectionOptions = {}): WireEvent | null {
	const wireType = (DURABLE_TO_WIRE as Readonly<Record<string, WireEventType | undefined>>)[event.type];
	if (wireType === undefined) return null;
	if (wireType === "thinking" && options.exposeThinking !== true) return null;
	const sanitize = options.sanitize ?? sanitizeToolArgs;
	const source = event as unknown as Readonly<Record<string, unknown>>;
	const projected: Record<string, unknown> = { seq: event.seq, type: wireType };
	for (const field of WIRE_FIELDS[wireType]) {
		if (!(field in source)) continue;
		const value = source[field];
		if (value === undefined) continue;
		projected[field] = SANITIZED_FIELDS.has(field) ? sanitize(value) : value;
	}
	return projected as unknown as WireEvent;
}
