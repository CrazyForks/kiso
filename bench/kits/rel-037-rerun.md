# Kit — the 0.37.0 release ceremony, re-run

**PRE-REGISTERED. No leg runs before the owner's own word to the executor.**

The first ceremony FAILED and is recorded at
`kiso-doc/rel-037-ceremony-2026-09-17.md`. It is **reported beside this
round and never pooled with it**: its result was seen before these criteria
were written, and a round whose bar is chosen after seeing a result is not
a test.

## What changed since it, and why each change is allowed

**1. The margins were wrong, and the error was the lead's, declared in the
ruling.** The first ceremony ran `bm1-frozen` (+6% median cost). That
margin is retired: `bench/paired-compare.mjs` carries `bm1-a1` — BM-1
Amendment 1 of 2026-08-27, **the default since the rel-030 freeze** — at
**median cost ≤ +20%**, with a single pair over +50% an anomaly note rather
than a block. 0.30.0 and 0.31.0 both shipped under it. CLAUDE.md still
quotes the superseded +6%, which is where the citation came from.

**This round pre-registers `bm1-a1`.** The first ceremony is not re-judged
under it.

**2. The empty-input edge was UNDECIDABLE, and the task is fixed.** Five
legs across five rounds, both products, all three arms have failed it. The
cause is not an unstated edge — it is a stated OUTCOME the code cannot
determine: turn 5 said to skip parts that do not parse, and the fixture's
`parseRange('')` returns `{end: 0}` with no throw and no null, so nothing
in the code can tell a non-parsing part from a parsing one.

Turn 5 now states the RULE — *a part parses only if it is of the form a-b
with a number on each side; parseRange cannot report failure, so the check
is yours* — and not the ANSWER. Stating the answer would copy the held-out
boundary's own assertion into the task and make a test into a quotation.
Fixed in both `tasks-t5.json` and `tasks-t6.json` (commit d04264f).

**Legs run after that commit are not comparable to earlier ones** on turn 5
or anything derived from it.

## The round

| | |
|---|---|
| arms | rc **v0.37.0 as built** against the **PUBLISHED 0.36.0** |
| control binary | installed into a clean prefix, invoked by **absolute path** |
| identity | `meta.kisoVersion`, probed from the binary, checked **per leg**; a mismatch VOIDS the leg and stops the scoring |
| n | **12 pairs**, T5, serial, interleaved with the order alternating per pair |
| cost | about **$0.28** |

## Criteria — `bm1-a1`, frozen here

| criterion | bar |
|---|---|
| verify | **100%** |
| median cost delta | **≤ +20%** |
| single pair > +50% | an **anomaly note**, not a block |
| median wall delta | **≤ +25%** |

## The power statement, from the first ceremony's own dispersion

The first ceremony measured a paired cost sd of **29.6 points** at n = 12,
so SE ≈ **8.5 points**.

| if the true effect is | chance this round FAILS the +20% bar |
|---|---:|
| the observed +7% | **~7%** |
| +20% | **~50%** |
| +35% | **~96%** |

**This round can detect a large regression and cannot resolve a small
one.** That is stated before it runs rather than discovered in its result.

## Reported, never judged

Effect sizes with their intervals — the read-back rate, cost, requests,
wall — and the first ceremony's numbers beside them, unpooled.

## Before the freeze

The fixture fix is in. The criteria binding and this kit are the freeze.
**The owner's own word to the executor** is the last gate; a relayed
approval does not buy legs.
