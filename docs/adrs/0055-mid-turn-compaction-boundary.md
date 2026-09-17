# ADR-0055: A settled round is a legal compaction boundary — a long run must not end at the window

- **Status:** DRAFT — for the lead's review, then the owner's ratification.
  Nothing is built.
- **Date:** 2026-09-17
- **Layer:** the kernel loop's compaction path and the CLI's auto-compact
  check. A behaviour change, gated by the 0.38.0-line ceremony.

## The hazard, first

**This ADR proposes making the product throw away context DURING a turn
that is still running.** Everything below is subordinate to that: a
boundary chosen wrongly discards something the model was about to use, and
the failure is silent — the run continues, worse, with no error anywhere.

That is why the boundary is not a token count. It is a **settled round**:
a point the durable log already recognises, where no tool call is
outstanding and no model output is mid-stream. A1a defined it
(`checkpointBoundarySeq`) and deliberately did not fire it. This ADR is
the firing, and the reason to be careful is that A1a's own note said the
definition was the easy half.

## What the product does today, verified in the tree

| | |
|---|---|
| summary compaction | cuts only at a **user-turn boundary** — `summaryBoundarySeq` takes the keepRounds-th most recent `user_input` |
| the CLI's auto-compact check | **returns when a run is in flight** — `chat.ts`: `if (currentRun !== null) return;` |
| window overflow | ends the run, `context_overflow`, **`retryable: false`** — `packages/core/src/kernel/loop.ts:980` |
| `checkpointBoundarySeq` | exists, and **nothing in the tree calls it** — verified across `packages/*/src`, `apps/*/src`, `extensions/*/src` |
| microcompact | fires inside the loop on a token estimate — `loop.ts:565` — and clears **tool results only** |

**So a single long autonomous run has exactly one relief between it and a
hard stop, and that one only drops tool results.** Every other mechanism
waits for a user turn that an autonomous run does not have.

This is the shape of the defect: not "compaction is tuned badly" but
"compaction is unreachable from inside a turn".

## Decision

**A settled round is a legal compaction boundary**, and compaction may
fire at one without a user turn.

### Three tiers, and what each is for

| tier | fires at | threshold |
|---|---|---|
| soft | the end of a **phase**, when eligible | `min(0.5 × window, 400K)` |
| hard | the **next settled round**, unconditionally | `min(0.8 × window, 700K)` |
| emergency | **before the next request** | `window − reserve` |

`reserve` is **at least the output we actually request** — not a constant.
A reserve smaller than the output the request asks for is a reserve that
does not reserve.

**The recent raw tail is kept BY TOKENS (~20K), never by rounds**, and
**never includes the round in flight.** Rounds vary in size by an order of
magnitude; a tail measured in rounds keeps an unknown amount of context.

**Overflow becomes recoverable**: one compaction at the last settled
round, then **one** retry. One, not a loop — a retry that can repeat is a
way to spend a budget without ending.

**Microcompact stays**, as the floor, at the soft tier. It is cheaper than
a summary and it already works; this ADR gives it a companion for the case
it cannot reach.

**Default ON.** A relief that must be discovered and enabled is a relief
most users do not have, and the population this protects — long
autonomous runs — is the one least likely to be watching.

## How it will be measured, and what the measurement can and cannot say

**Functional first, effects reported.** The gate is behaviour, not
improvement:

1. each tier fires **where it is declared to** and nowhere else;
2. the recent tail **survives** every tier;
3. an overflow **recovers** — one compaction, one retry, the run continues;
4. no compaction ever lands **inside** a round that has an outstanding
   tool call or a stream in flight.

Those are yes/no and are the shipping condition.

**Effect sizes are reported and judged by nothing**, on the CTX-1 scaled
instrument. The honest statement up front: **this programme's paired cost
measurements at n=12 have a per-pair spread near 30 points and cannot
resolve an effect under about 20%.** Two ceremonies of the same change
disagreed by 22 points. So a cost number from this round will be reported
with its interval and will not be claimed as a win, and the round is not
sized to detect a small one.

## What this ADR does not decide

- **The 2:1 microcompact ratio.** CTX-1 settled that capacity is not
  policy; the ratio is a measurement item (ACI-9), not this change.
- **What a summary should contain.** This is about WHEN, not WHAT.
- **The window numbers themselves.** REG-1 put the DeepSeek rows on the
  registry's dated-vendor-statement footing; that is a separate change and
  already landed.

## When to overturn it

- **A boundary that discards something needed.** If the functional gate
  passes and real sessions still lose work at a settled round, the
  boundary is wrong and the definition — not the thresholds — is what must
  change.
- **A measured cost regression that clears the noise.** Not a number
  inside the interval; one that a properly sized round separates from
  zero.
- **A simpler relief that reaches inside a turn.** If microcompact alone
  can be made sufficient, three tiers are three things to get wrong.
