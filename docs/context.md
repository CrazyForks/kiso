# Context economy — microcompact, `/compact`, and the byte discipline

Three mechanisms, in the order a session meets them: a zero-API boundary
that clears old tool output, a model summary that compresses the
conversation itself, and the byte contract that keeps both of them
cache-friendly and replayable.

## In-run compaction — the tiers (ADR-0055 Amendment 1)

**The CLI ships it ON by default**, drawn from the LIVE model's window
(`/model` and `/resume` move the window with the model — CTX-1). Before
every request the kernel asks the runtime whether to compact; the context is
measured by the provider's own count of the last request (§1a), the
estimate only where no bill describes it. `soft = min(0.5·window, 400K)`
makes compaction eligible and it fires at the next settled round that ends a
phase (a check ran, edits finished, reading finished, a new turn);
`hard = min(0.8·window, 700K)` fires at the next round regardless;
`emergency = max(window − reserve, hard)` before the next request. The
summary is requested IN-BAND — the run's own cached prefix with the
instruction appended — with one fallback to the serialised form, and the
most recent `min(0.1·window, 100K)` stays verbatim. A provider that still
refuses the context gets one compaction and one retry.

## MicroCompact — the prune primitive

**No longer a standing trigger** (ADR-0055 Amendment 1, A4): repeated
mid-history clearing breaks the prompt cache on every clear. The
`microcompacted` event and its projection stay; the tiers use a prune only
when a summary cannot complete, and only where the break-even rule says it
pays. Library callers that configure `microcompact: { thresholdTokens }`
explicitly keep its old standing behaviour, now run by the runtime.

A model the registry has no window for falls back to 200,000, and its
threshold to 100,000. That is a stated unknown, not a measurement: the
registry never guesses. CAPACITY (what the model can hold) and POLICY (when
we choose to clear) are separate questions that this single fallback
currently answers together, and the 2:1 ratio between them has never been
measured.
Library users opt in with `microcompact: { thresholdTokens }` in
`createAgent`. When a session's projected context crosses the threshold,
the runtime appends **one** `microcompacted` boundary event through the
kernel's compaction point —
never a per-turn progressive clearing. The projection then derives the
compacted view deterministically: tool results older than the boundary
whose tool is in the whitelist (`read_file`, `list_dir`, `search_text`,
`shell`) are replaced by the fixed placeholder
`[old tool output cleared: <tool> <arg>]`. write/edit outputs are never
touched; results tagged `do-not-compact` are never touched; recent turns
stay intact.

The decision is a persisted fact, not runtime state: the same events always
derive the same messages — a crash/resume replays the boundary and lands on
the byte-identical projection (see the byte discipline below). No counting
API, no price table, no tokens spent on the compaction itself.

**The model-summary layer (`/compact`, ADR-0044)**: the mechanical clearing
works on tool results only — the CONVERSATION still grows. `/compact`
(summarize the older conversation to free context) compresses the covered
rounds — everything before the most recent 4 rounds, from the last summary
point — into one durable `summarized` event via an off-loop call through
the session's own adapter. The projection replaces the covered range with
a single assistant summary message; the original events stay on disk
forever (the raw log, /last, and /think still reach them); a crash before
the persist is "nothing happened", after it the resume projects the
compressed view. The classic auto-compaction (`config.compaction` +
`compacted` events) was retired into the boundary by ADR-0044 — old logs
with `compacted` events replay verbatim, forever. (Matrix note: context
economy ◐→● — ◐ was the mechanical clearing alone, 0.1.19; ● adds the
model summary, 0.1.20.)

Wired end to end and test-verified: a session running through the real
runtime records the boundary on disk and a reloaded session projects the
placeholders (`packages/runtime/tests/microcompact-e2e.test.ts`); the CLI
resumes an over-threshold session with a tiny window and the boundary
lands (`apps/cli/tests/microcompact-cli.test.ts`).

## Prompt-cache byte discipline

Contract: the same event-stream prefix projects to a **byte-identical**
message prefix (`JSON.stringify`, element for element). New events only ever
change the projection at the tail — the one exception is the `microcompacted`
boundary, itself a persisted fact whose replay derives the same projection
every time. The contract is pinned by three regression tests
(`packages/core/tests/prompt-cache.test.ts`): ① the same log projects
identically twice, ② appending a turn leaves the old prefix byte-identical,
③ a microcompact boundary replays byte-identically after a JSON round-trip
(the crash + resume shape).
