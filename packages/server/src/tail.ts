import type { Event } from "@vincemakes/kiso-core";

export type Listener = (event: Event) => void;

/**
 * Replay-then-live, exact by sequence number.
 *
 * The reconnect guarantee: a subscriber that names the last seq it saw
 * receives every event after it exactly once — the ones already on disk
 * (persist-first: every event is written before a run yields it) and the
 * ones the live run emits from now on, in order, with no duplicate at the
 * seam. The seam is the only hard part: an event the run emits WHILE the
 * replay is being read must neither be lost nor sent twice. It is
 * buffered until the replay ends, then sent only if its seq is beyond
 * what the replay covered.
 *
 * Both hosting products wrote this function independently, flag names
 * included. It is one function now.
 */
export function tail(
	replay: () => Iterable<Event>,
	listeners: Set<Listener>,
	after: number,
	send: Listener,
): () => void {
	let sentUpTo = after;
	const buffered: Event[] = [];
	let replaying = true;
	const listener: Listener = (event) => {
		if (replaying) {
			buffered.push(event);
			return;
		}
		if (event.seq <= sentUpTo) return;
		sentUpTo = event.seq;
		send(event);
	};
	listeners.add(listener);
	for (const event of replay()) {
		if (event.seq <= sentUpTo) continue;
		sentUpTo = event.seq;
		send(event);
	}
	replaying = false;
	for (const event of buffered) {
		if (event.seq <= sentUpTo) continue;
		sentUpTo = event.seq;
		send(event);
	}
	return () => {
		listeners.delete(listener);
	};
}
