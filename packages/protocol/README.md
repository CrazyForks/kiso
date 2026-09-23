# @vincemakes/kiso-protocol

The wire contract between a hosted kiso session and its clients: request
envelopes, wire events, the session snapshot, one error shape, a version.
Zero runtime dependencies — a browser client imports this and nothing
else from kiso.

**A wire event is a projection, never the durable event.** The runtime's
27-variant Event union answers "what became a fact" and is frozen by
ADR-0051; the wire answers "how two processes talk". `DURABLE_TO_WIRE`
names the durable types that reach the wire (and the one rename:
`model_output_abandoned` is `draft_voided` on the wire), `NOT_ON_WIRE`
names the ones that do not, and `WIRE_FIELDS` is the allowlist of fields
per wire type — a field absent there never reaches the wire, whatever the
durable event holds. The projection itself (`toWireEvent`) lives in
`@vincemakes/kiso-server`, which knows the durable types; this package
only says what comes out.

Off the wire by decision: `usage` (a product bills through its own
frames — `WireFrame`), `stop` and the assistant / compaction boundaries
(control facts that render nothing), `tool_call_input_delta` (the end
carries the input). `thinking` is on the table but the projection exposes
it only when asked.

See the repository README for the framework overview.
