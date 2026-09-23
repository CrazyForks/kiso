import type { Event } from "@vincemakes/kiso-core";

/**
 * The events that end a tool execution, stated ONCE.
 *
 * The two products that counted executing tools by hand disagreed on this
 * set: one stopped at succeeded / failed, the other also counted resolved.
 * Resolved belongs here — an uncertain execution that received its verdict
 * is no longer executing, whichever verdict it got.
 */
export const EXECUTION_ENDED: ReadonlySet<Event["type"]> = new Set<Event["type"]>([
	"tool_execution_succeeded",
	"tool_execution_failed",
	"tool_execution_resolved",
]);

/** +1 when a tool starts executing, −1 when one ends, 0 otherwise. */
export function executionDelta(event: Event): -1 | 0 | 1 {
	if (event.type === "tool_execution_started") return 1;
	return EXECUTION_ENDED.has(event.type) ? -1 : 0;
}
