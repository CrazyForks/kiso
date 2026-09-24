# @vincemakes/kiso-server

The hosted-session service: many durable kiso sessions in one long-lived
process, each with observers, one run at a time. It is the layer a product
backend puts between its HTTP (or socket, or stdio) handlers and the
runtime — the layer two products wrote independently before this package
existed.

It is not a transport, and it is not a second agent. Every session here is
`runtime.createAgent(...).session({ id })`; every run is that session's
`run()` / `resume()`. The product supplies the agent factory; the service
never learns what the agent is for.

```ts
import { createSessionService } from "@vincemakes/kiso-server";
import { createAgent, SessionStore } from "@vincemakes/kiso-runtime";

const store = new SessionStore("./sessions");
const service = createSessionService({
  store,
  open: async (sessionId) => createAgent({ /* the product's definition */ store, model, tools, extensions }),
});

const { runId, done } = await service.run("s1", "hello");     // InFlightError | OpenRunError | DrainingError
const off = await service.subscribe("s1", lastSeqSeen, (ev) => send(ev)); // replay, then live, exactly once
await service.approve("s1", decisionId, true);                 // → { needsResume }
await service.abort("s1");                                     // → idle | parked (who is waited for) | stopped
await service.drain(20_000);                                   // → { waitedFor, parked, interrupted, timedOut }
await service.close(5_000);                              // abort what is live, wait up to the grace
```

## What it decides, and what it leaves to the host

- **One run per session.** A second `run()` while one is live refuses
  with `InFlightError`.
- **An open run in the log** (a previous process died inside it) refuses
  with `OpenRunError`; `run(input, { resumeFirst: true })` resumes it to its
  terminal first. Silent resume is the one option not offered.
- **Abort while parked.** A run waiting for a person — a kernel approval,
  or whatever `hooks.parkedBy` names (the ask extension's questions) —
  is parked, not running. `abort()` returns `{ kind: "parked", ... }` and
  does nothing; `{ force: true }` aborts anyway. "stopped" carries a
  `settled` promise: the kernel does not kill a tool, so a tool that
  ignores the abort keeps its run open until it returns.
- **After the last uncertain verdict** the service does not resume;
  `resolveUncertain` returns `{ remaining }` and the host resumes at zero.
- **Executing tools** are counted from `tool_execution_started` and the
  three ending events (succeeded, failed, resolved) — `EXECUTION_ENDED`,
  stated once.
- **Product frames on the stream** (billing, estimates, couriers) are the
  transport's business; the service delivers the durable events only.

## What the host owns

- **The store.** `createSessionService({ store })` takes the store the
  factory's agents write to; the service never closes it — `close()`
  aborts runs and forgets sessions, and the host calls `store.closeAll()`
  when its process ends. Everything about an open session is read from
  that session's own log (the object the run writes), so replay and run
  share one truth by construction; a factory that binds its agents to a
  DIFFERENT store is detected — the first run to settle on such a session
  ends with `StoreMismatchError` and the session is refused from then on.
- **The sanitizer's guarantee.** The default `sanitizeToolArgs` strips
  prose keys and truncates long strings at every depth. It is a UI-noise
  and casual-leak filter for a tool card, not a privacy boundary: a
  product that must guarantee no prose reaches a client supplies its own
  `sanitize` in the projection options.

## Shutting down, and one thing not to call

The order that keeps every run resumable: `service.drain(graceMs)` (no
new runs; wait for executing tools; the report says what was parked or
cut), then stop the listener, then `store.closeAll()`, then exit. Do not
call `service.close()` for that — it ABORTS what is live, including a
run parked at an approval, which voids the draft its answer would have
continued. And do not call `agent.close()` on a factory's agent when the
store is shared: in the runtime it closes the whole store.

`hooks.onSettled` is the product's "what next" after a run: a follow-up
turn, a resume when `uncertainRemaining` reaches zero, a notification.
The service never starts a run on its own.

## What a host still writes

The transport (routes, SSE framing, `Last-Event-ID`, keepalive, status
codes), the agent factory, and any per-session product state it feeds the
factory. The service is the part that was the same in every host.

## The HTTP + SSE transport — `@vincemakes/kiso-server/http`

`createHttpHandler(service, { authorize, augment?, prepareInput?, projection?, keepaliveMs? })`
returns a `handle(req, res)` a host mounts in front of its own routes; it
answers the agent routes under `prefix` (default `/v1/sessions`) and
returns false for everything else. Status codes and framing are decided
here once: `id: <seq>` / `event: <type>` / `data: <WireEvent>`, an `: open`
preamble, `Last-Event-ID` and `?after`, a keepalive; `in_flight` and
`open_run` are 409, `draining` 503, `forbidden` 403. Wire events are the
projection in `@vincemakes/kiso-protocol` — never the durable event.
`authorize` is required: there is no default that allows.

