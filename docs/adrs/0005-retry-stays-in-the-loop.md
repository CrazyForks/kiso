# ADR-0005: Retry stays inside the loop — no side-channel state

- **Status:** Accepted
- **Date:** 2026-08-02
- **Layer:** L2 Kernel

## Context

pi-mono's retry promise is created on `agent_end`, gated on
`_lastAssistantMessage`, resolved from a different path than it was created —
an exception path skips `message_end` entirely and the promise never resolves:
`waitForRetry()` hangs forever and only ESC unwedges it. Its error classifier
is one regex over error strings: it misses 529, ECONNREFUSED, and quota codes,
and false-positives on any text containing "500".

## Decision

Two rules, both structural:

1. `StructuredError` is a closed code union (`rate_limit` / `overloaded` /
   `network` / `timeout` / `quota` / `api_5xx` / `context_overflow` /
   `invalid_request` / `unknown`), classified at the adapter boundary. No
   regex over error text anywhere.
2. Retry state (attempts, backoff, budget) lives entirely inside the loop's
   generator frame — the loop retries a `retryable` error by re-entering
   `adapter.stream()` itself, and yields `terminal { kind: 'error' }` when the
   budget is spent. Nothing outside the loop ever resolves or aborts a retry,
   so there is no promise to leak, no side channel to desync, and no race
   with a concurrently-queued user prompt.

## When to revisit

A product needs retry policy that the loop cannot express (e.g. cross-run
retry with session memory). That is harness territory — the loop's contract is
only "retryable errors are retried here, terminal is honest".

## Amendment 1 (2026-08-26, the F4 round): the budget is per-process, and mid-stream retries share it

F4 extends rule 2 to the mid-stream cut: a retryable error arriving
AFTER streaming began settles the attempt, durably voids the draft
(`model_output_abandoned`), and re-enters `adapter.stream()` under the
SAME per-turn `attempts` counter that pre-stream retries use. One
budget bounds total provider re-entries per turn — each mid-stream
retry re-pays its input tokens, so a separate budget would double the
worst case.

Made explicit, because frame state dies with the process: **the budget
is per-process by design.** A crash during backoff (or after the void,
before the re-request) leaves the marker as the last durable boundary;
the resume derives CONTINUE_MODEL and the new process runs a FRESH
in-frame budget. "Bounded requests per turn" therefore holds within one
process lifetime, not across crashes. A durable retry ordinal was
considered and rejected: it would add a durable field to buy a strict
cross-crash bound no observed failure demands — if reality ever
produces a crash-retry loop, that evidence reopens this amendment.

## Amendment 2 (2026-09-18, the launch build): the backoff, the budget, and a retry you can see

**What changed and why.** CX-1 F8 set the n-th retry's wait to
`max(n × 250 ms, Retry-After)` and the default budget to 2. Against the
failure this project actually meets — a gateway that drops a stream and
comes back — that is a budget spent in **under a second**: three attempts
inside 750 ms. 0.39.1 made the transport-failure-after-headers class
RETRYABLE, correctly, and the kernel then gave it that 750 ms. A gateway
gone for three seconds still ended the turn.

The shape is taken from a reference implementation's installed build
(read 2026-09-18) and re-stated here as kiso's own rule:

1. **The delay** for the n-th retry is
   `min(500 ms × 2^(n−1), 32 s)`, plus up to 25% of that as random
   jitter, and never less than the provider's `Retry-After`:
   0.5 / 1 / 2 / 4 / 8 / 16 / 32 / 32 / 32 / 32 s. It is computed ONCE
   per failure — the cap check and the sleep read the same number, or the
   jitter would let them disagree about whether a wait was allowed.
2. **The budget** defaults to 10, about 2.7 minutes before a turn gives
   up. `RETRY_AFTER_MAX_MS` is unchanged: a provider asking for more than
   60 s still ends the run with an explicit error rather than a wait.
   The per-turn, per-process budget of Amendment 1 is unchanged — pre-
   and mid-stream retries share it — and so is its cost: every retry
   re-pays the turn's input, so a turn that uses its whole budget has
   paid for its prompt eleven times.
3. **The retry is OBSERVABLE.** Before each wait the kernel calls the
   optional `HookHost.onRetry` with the attempt, the budget, the error
   code and the delay. Observation only: it cannot change the decision,
   it is awaited with errors swallowed exactly as `onEvent` is, and it
   writes nothing — a retry is not a durable fact (§ rule 2 above: retry
   state lives in the loop's frame). This is not optional in spirit: a
   2.7-minute retry whose only sign is a moving clock cannot be told
   apart from a model that is thinking, and a person cannot decide
   whether to wait or stop. (It is NOT the frozen row the owner reported
   the same day — a retry's wait is asynchronous and the spinner keeps
   turning through it; only a blocked event loop stops both the glyph
   and the clock, and that report stays open on its own evidence.)

   The CLI shows it on the running row as a fact —
   `retrying 3/10 · network · 4s`, the seconds counted down at every
   repaint — and composes that row to the terminal's width, so at 80
   columns a gesture hint gives way and neither the retry nor the
   context figure is cut.

**The summary call follows the same rule.** `/compact` and the auto
context policy call the adapter directly, off the loop, so the kernel's
retry never reached them; 0.39.1 gave that call one retry of its own
after 250 ms. It now takes the kernel's policy — the same curve, the same
`maxRetries` from the session, Retry-After as a floor, a wait beyond the
cap as an explicit stop (0.39.1 retried such a call after 250 ms, early,
against the provider's own ask), an abortable wait, and the same
`onRetry` through the session's composed hooks. A dropped summary stream
is the same failure as a dropped turn and meets the same gateway; each
retry re-pays the summary's input exactly as a turn retry re-pays the
turn's, and one budget bounds both. The compacting row shows it as the
running row does.

**What did not change.** Classification stays at the adapter boundary
(rule 1). The loop still owns every retry (rule 2). The F4 abandon —
void the draft durably, then retry — is untouched; a turn that retries
mid-stream ten times leaves ten `model_output_abandoned` markers, each a
boundary the resume path already knows.

**The budget is a front-door setting, not a kernel read.** The kernel reads
no environment. The CLI maps `KISO_MAX_RETRIES` to `maxRetries`,
clamped to 15 so a typo cannot turn one bad request into an hour of
retries.
