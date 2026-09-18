# ADR-0055: A settled round is a legal compaction boundary — a long run must not end at the window

- **Status:** **Accepted** — reviewed by the lead, then ratified by the
  owner on 2026-09-17 in their own words. Nothing is built yet; the
  decision is recorded and the code follows its own round.
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
| the auto-compact trigger's NUMBER | a **chars/4 projection** — `autoCompactRatio` → `estimateCtxRatio`, `JSON.stringify(session.projected()).length / 4 / window` (`chat.ts:169`, `:202`) — never the provider's own count |

**So a single long autonomous run has exactly one relief between it and a
hard stop, and that one only drops tool results.** Every other mechanism
waits for a user turn that an autonomous run does not have.

This is the shape of the defect: not "compaction is tuned badly" but
"compaction is unreachable from inside a turn".

## Decision — A1b v1

**A settled round is a legal compaction boundary**, and compaction may
fire at one without a user turn. Three control paths, and deliberately not
a tier system.

### 1. One threshold

When the context crosses `min(0.5 × window, 400K)`, compact at the **next
settled round**. Never the round in flight. Pairing and do-not-compact
rules are unchanged.

**This number is not measured, and the ADR says so rather than implying
otherwise.** It has a cost model behind it (below) and the model has
assumptions in front of it — the number is a stated position, not a
finding. It is a **knob with a default**, tuned post-launch. The section
"Why 400K" says exactly what the model does and does not establish,
including that 400K is not the cheapest threshold under any assumption
tested.

### 1a. What the number is measured against

The threshold above and the reserve guard below are both comparisons, and
this ADR fixes what they compare.

**When the last settled round reported usage, that is the number.** The
provider states the size of the prompt it actually read; an estimate is a
guess about the same quantity, and where the fact exists the guess has no
standing. Two comments in the tree already reserve this move for A1b, by
name: `request-budget.ts:18` ("the auto-compact policy keeps its own
number — moving it is A1b's") and `chat.ts:200` ("the pre-A1a estimate,
unchanged this round, named so a gate can pin that it did not move").

**The number is the CANONICAL total, never the raw usage fields.** It is
`canonicalizeUsage(...)` followed by `c.input + c.cacheRead +
(c.cacheWrite ?? 0)` — the `total` that `usageFromEvent` already computes
at `chat.ts:271`.

This is not a stylistic preference about which helper to call. The raw
`usage` event is MIXED-CONVENTION across adapters, and has been since both
were written:

| adapter | what `inputTokens` carries |
|---|---|
| openai-compat | `prompt_tokens`, which **already includes** the cached part reported separately as `cacheRead` |
| anthropic | `input_tokens`, which **excludes** cache reads (`cache_read_input_tokens` is its own field) |

So `inputTokens + cacheRead` — the obvious reading, and the one this ADR
was first drafted with — double-counts every cached token on
openai-compat, and omits `cacheWrite` on both. On a long cached session
the cached part IS most of the prompt, so the threshold would fire far
early on exactly the runs A1b exists to make cheaper. The declared-
behaviour block above `usageFromEvent` is where that convention split is
written down (the E2 1.3.0 / R2a-1 ruling, 2026-08-13); it is the
accounting boundary, and A1b is a consumer of it rather than a fourth
convention.

**The estimate stays, as the fallback.** No known usage exists before the
first request of a session, after a turn that errored before reporting,
or whenever an adapter sends `known: false`. There the chars/4 projection
governs, exactly as today — a policy needs a number.

**A usage event survives the compaction that invalidates it.** The last
usage describes the PRE-compaction prompt; nothing re-reports until the
next request returns. Read naively it clears the threshold again the
instant the compaction finishes, and the run compacts in a loop. So a
usage event recorded at or before a compaction boundary is STALE and does
not govern: until a later one lands, the estimate does.

This changes no number in this ADR. It changes what the number is
compared against.

### 1b. The summarisation request must be prefix-identical

**REQUIREMENT, not an optimisation.** The summarisation call must be
prefix-identical to the session's own request up to the boundary — same
system prompt, same tool table, same messages, with the summarise
instruction appended at the **END**. Then the covered range bills at the
cache-hit price.

A summary request built any other way re-bills the whole covered range at
the miss price. At a 400K threshold that is
`400,000 × (0.15 − 0.003) / 1M = $0.0588` — **about six cents per
compaction, more than everything else the compaction costs combined.** A
compaction that costs more than the context it saves is not a saving.

It is also the easiest thing here to get wrong invisibly: a summary
request assembled "cleanly" from scratch looks more correct and costs
twenty times as much, with nothing in any log saying so. So it gets a
gate that reads the money rather than the shape: **in the request dump,
the summary call's cached-token count ≈ the covered range.** A prefix
that diverged shows up as a cached count near zero.

### 2. One reserve guard

Before sending a request: if the projected context exceeds
`window − reserve`, compact first. `reserve` is **at least the output we
actually request** — not a constant. A reserve smaller than the output the
request asks for is a reserve that does not reserve.

This is not a tier. It is the guard against a **single big jump** — one
tool result that clears the threshold and the window in the same step, so
that "compact at the next settled round" never gets a next settled round.

### 2a. What one compaction's OUTPUT costs — measured, and the diagnosis reversed

The reserve guard above has to hold the summary's own output, and until
2026-09-18 that figure was an assumption: the summary call carried a
fixed 4,000-token budget (`SUMMARY_MAX_OUTPUT`), and `POLICY_RESERVE` was
built on it. A live session broke the assumption — `/compact` on an
unregistered DeepSeek model behind a gateway failed with
`the summary turn ended with max_tokens` — and one authorised measurement
on that profile, over a covered range of the reported size (~100k tokens
of real source), gave:

| output budget | stop | reasoning | checkpoint | sections |
|---|---|---|---|---|
| 4,000 | `max_tokens` | 3,093 | 828 | 3 of 7 |
| 8,391 | `max_tokens` | 1,613 | 6,544 | 4 of 7 |
| 32,000 | `end_turn` | 3,557 | 15,261 | 7 of 7 |

**A complete checkpoint of a ~100k range took 18,837 output tokens.**

**The diagnosis reversed, and the reversal is the finding.** At 4,000,
reasoning was 77% of the budget, and the obvious reading was "thinking
eats the budget — turn thinking off". With room, reasoning was about a
fifth; **the checkpoint itself is the size.** Reasoning only looked
dominant because the budget was too small for the checkpoint to start.
Turning thinking off would have reduced the cost of the failing call and
left it failing.

What A1b must therefore plan for:

- **The reserve.** A fire at a ~100k covered range needs room for a
  ~15–19k-token checkpoint, not 4,000. `POLICY_RESERVE` as built
  under-reserves by roughly 15k on exactly the sessions this ADR exists
  for. The reserve guard (§2) and the threshold's arming point (§1) both
  move with it, and moving them moves when every session compacts — which
  is why 0.39.2 raised only the MANUAL gesture's budget and left the
  policy byte-identical: that change belongs here, with the bench.
- **The cost model.** Output is about a cent per compaction at this
  model's price. It is not the term that matters; the reserve is. The
  "Why 400K" section's cost model priced input re-reads and cache
  behaviour — it should carry the checkpoint's output as a stated term,
  so the next re-derivation does not reintroduce 4,000 by omission.
- **The ratio is not a law.** 18,837 out of a ~21k-token SERIALIZED input
  is barely compression; the saving comes from what serialisation
  truncated (the ~100k projected range), not from the summary being
  short. A different model, prompt or range will give a different ratio.
  Planning numbers come from measurement per model family, not from this
  one row generalised.
- **Prefix identity (§1b) is unchanged** by any of this: a larger budget
  is a request parameter, not a change to the prefix the summary call
  shares.

A budget rule scaled from the covered estimate (a twelfth: 8,391,
doubling once to 16,782) was built BEFORE this measurement and would have
failed both attempts on this data while its tests stayed green. It was
removed in its own commit so the history shows the rule and what
falsified it. The lesson for A1b's numbers is the same one the 400K
section learned: a rule derived before the measurement is a guess about
the measurement.

### 3. One recovery

`context_overflow` → compact at the last settled round → retry **once** →
then end as today. One retry, not a loop: a retry that can repeat is a way
to spend a budget without ending.

This is the failure path for a compaction that did not happen or happened
too late. It is not a third tier and must not be read as one.

### And what does not change

**Microcompact stays**, as the floor, at the same threshold. It is cheaper
than a summary, it already works, and it is the only thing that reaches
inside a turn today; this ADR gives it a companion for the case it cannot
reach, and takes nothing away.

**The recent raw tail is kept BY TOKENS and scales with the window —
`min(0.1 × window, 100K)`** — never by rounds, and never including the
round in flight. Rounds vary in size by an order of
magnitude; a tail measured in rounds keeps an unknown amount of context.

**Default ON.** A relief that must be discovered and enabled is a relief
most users do not have, and the population this protects — long
autonomous runs — is the one least likely to be watching.

Overflow recovery and the reserve guard are the ONLY new control paths in
the loop. That is the whole surface.

## Why 400K — a cost model, a rule, a count, and a measured cache

**Assumptions, named as assumptions.** DeepSeek off-peak prices (cache
hit 0.003 / miss 0.15 / output 0.6 per M tokens, the rates REG-1 recorded
with their vendor source); 300
requests of 3K new tokens each; a 40K tail kept across a compaction; and
per compaction, a summary written out, one cache break on the next
request, and two re-reads. None of these are measured. They are a stated
position about a shape of session.

Total context cost under that model, output excluded:

| threshold | cost | compactions |
|---|---|---|
| 100K | $0.36 | 14 |
| 200K | $0.30 | 5 |
| 300K | $0.31 | 3 |
| **400K** | **$0.34** | **2** |
| 600K | $0.39 | 1 |
| never | **$0.54** | 0 |

**Reproduced independently before adoption.** Rebuilt from the
assumptions above, the curve lands at $0.539 / $0.389 / $0.342 for never
/ 600K / 400K — the same to the cent — and diverges only at 100K
($0.42, 15 compactions), where the result depends most on the two
quantities the model does not state: how long a summary is and how much
gets re-read after one.

**And that divergence is the finding, so it is recorded rather than
smoothed.** Sweeping summary length (1K–8K) against re-read volume
(5K–50K), across every combination:

- **never compacting is the most expensive, always.** That conclusion does
  not depend on any assumption here.
- **the cheapest threshold is never 400K.** It sits between 150K and
  300K, most often 200K.
- **400K costs between +2% and +19% more than the cheapest**, and which
  end of that range applies is decided by ONE unmeasured quantity: how
  much is re-read after a compaction. Cheap re-reads make 400K expensive;
  expensive re-reads flatten the curve and make it nearly free.

So the honest statement of the decision: **400K is chosen for quality, not
cost.** Fewer summaries mean less information decay, and the cost of
buying that is somewhere between two and nineteen percent of the context
bill. Saying "400K is the upper end of a flat region" would be true only
under the assumptions that flatten it.

What makes this tractable rather than a matter of taste: the quantity the
choice turns on — post-compaction re-read volume — **is measurable**, on
the same scaled instrument, without a new one. It is the first thing to
measure post-launch, and it is what would move this number.

### The selection rule, and what it turned out to depend on

A rule was fixed **before its answer was seen**, to keep the default from
being chosen by taste: *the default is the LARGEST threshold whose cost is
within 5% of the cheapest in ALL twelve combinations.*

Applied mechanically to the session shape above (300 requests × 3K new
tokens, 40K tail), the worst-case excess over that combination's own
cheapest is:

| threshold | worst-case excess | within 5%? |
|---|---|---|
| 100K | 68.2% | no |
| 150K | 21.7% | no |
| **200K** | **4.2%** | **yes** |
| 300K | 9.3% | no |
| 400K | 18.7% | no |
| 500K | 32.0% | no |
| 600K | 38.1% | no |

**The rule selects 200K**, and 200K is the only threshold that passes at
all. 300K fails at 9.3%, and it fails in the cheap-re-read combinations —
the same parameter that decides everything else here.

**Then the rule was applied to six other session shapes, and it does not
hold still.** The twelve combinations varied summary length and re-read
volume; the session shape was held fixed and was never justified:

| session shape | the rule selects |
|---|---|
| 300 × 3K, tail 40K (the stated one) | 200K |
| 300 × 1K, tail 40K | 200K |
| 300 × 8K, tail 40K | **400K** |
| 300 × 3K, tail 80K | **300K** |
| 100 × 3K, tail 40K | **nothing passes** |
| 600 × 3K, tail 40K | **nothing passes** |
| 300 × 3K, tail 10K | **nothing passes** |

So the honest reading: **on three of seven plausible shapes the 5%
criterion is unsatisfiable** — the spread across assumptions is wider than
5% at every threshold — and where it is satisfiable the answer moves
between 200K and 400K. The rule's output is decided by the session shape,
which is the one assumption nobody has argued for.

What the model CAN establish is the region, and the region is the
original claim: the defensible answer lies **between 200K and 400K**, and
never-compacting is worse than any point in it. What it cannot do is pick
a point. **Within the region the choice is quality**, as it was before the
model existed — fewer summaries, less decay — which is why 400K was
proposed in the first place.

### Then the shapes were measured, and the imagined ones were wrong

The 5% rule was replaced with one that fits a region — **minimax regret**:
across every cell, each threshold's worst-case excess over that cell's own
cheapest; the default is the threshold minimising that worst case. Over
the 84 imagined cells it selects **200K at 24.3%**.

But the session shape was still imagined, so it was **counted instead**,
free, from the durable logs on this machine: 93 interactive sessions (of
99; 12 requests carried `known: false` and were excluded rather than
zeroed) and 207 autonomous bench legs (of 215 leg logs; the other 8 never
produced a usage event, and the 207 trace files under `sessions/traces/`
are a different artefact and are not sessions).

| | interactive (93) | autonomous legs (207) | **the model assumed** |
|---|---|---|---|
| requests per session | median 7, p90 18, max 104 | median 87, p90 114, max 137 | **300** |
| new tokens per request | median 572, p90 2,451 | median 362, p90 475 | **3,000** |
| peak context | median 8K, p90 39K, max 132K | median 30K, p90 49K, max **502K** | grows past 900K |
| sessions ever above 200K | **0%** | 1.9% | — |
| sessions ever above 400K | **0%** | **0.5%, one leg** | — |

**The assumed shape is an order of magnitude outside both populations.**

Rerunning minimax on shapes drawn from those measurements — tail still
swept, since the durable log cannot report it — gives **300K at 15.25%**,
and that is the default, per the rule: the count was in before the branch
reached the owner, so the real shapes decide.

**But the number that matters most is this one: five of the six real
shapes never cross ANY candidate threshold.** 83% of the cells are dead —
every threshold costs exactly the same. The default is therefore chosen by
**one observed session in three hundred**: the single leg that reached
502K.

And that leg **did not overflow and finished normally** (70 tool-use
stops, 8 end-turn, no `context_overflow` anywhere in its log). In 300
measured sessions there are **zero overflows**.

### What that does and does not mean

It does **not** retire this ADR. The defect is real and verified in the
tree, and the population it protects — long autonomous runs — is precisely
the tail that 300 sessions barely sample. One-in-three-hundred is the
definition of the case, not a reason to dismiss it.

It does mean three things must be said plainly:

- **The threshold is the least important of the three control paths.** It
  fires for about 2% of autonomous runs. The reserve guard and the
  overflow recovery are what stand between a long run and a hard stop, and
  they are not threshold-dependent.
- **The default rests on thin evidence and says so.** 300K is the least-bad
  choice across every shape we could imagine AND every shape we measured;
  it is not a finding, and one more long session could move it.
- **The measured peaks are peaks UNDER TODAY'S POLICY**, microcompact
  included. They report what sessions actually sent, not what they would
  have wanted to send. For choosing a threshold that acts on actual
  context, that is the right quantity; for asking "would A1b have helped",
  it is confounded, and a cleaner answer needs the instrument, not the
  logs.

### The last two assumptions, also measured

The model priced the carried prefix at the cache-HIT rate, i.e. assumed a
100% hit ratio. The vendor's own documentation says the cache is
best-effort with no guaranteed hit rate, and `usage` reports the split —
so it was counted rather than assumed.

| | requests | token-weighted p_hit | expected input price |
|---|---|---|---|
| interactive sessions | 937 | **0.9424** | **$0.0115 / M** |
| autonomous legs | 14,821 | **0.9812** | **$0.0058 / M** |
| *what the model assumed* | — | *1.0* | *$0.0030 / M* |

The real price of carried context is **two to four times** what the model
charged it.

**Cold starts are not the cause and barely exist.** Inter-request gaps in
real sessions: median 4s, p90 23s; **0.58% exceed an hour** and none
exceeds a day, against a vendor cache cleared in "hours to days". And the
gap before a miss (4.7s median) is indistinguishable from the gap before a
hit (3.8s) — **misses track prefix CHANGE, not idle time.** That is the
direct evidence for the prefix-identity requirement above: the cache is
lost when we change the prefix, and compaction is the largest thing that
changes it.

**The raw tail scales with the window**: `tail = min(0.1 × window, 100K)`.
A large window should buy headroom for big observations and a generous
recent tail — TRACE requires recent state to survive — not the carrying of
stale exploration on every request. At the hit price a 100K tail costs
about $0.0003 per request more than a 40K one.

**Break-even per compaction**, stated rather than implied — requests
before a compaction pays for its ~$0.012:

| p_hit | 900K→100K | 300K→100K | 200K→100K |
|---|---|---|---|
| 1.0 (assumed) | 6 | 21 | 41 |
| 0.9812 (legs) | 3 | 11 | 21 |
| 0.9424 (interactive) | 2 | 6 | 11 |

### What the rule returns now, and the finding that outranks it

Minimax over the measured shapes, with the 100K tail, at each p_hit:

| p_hit | 200K | 300K | 400K | 600K | selects |
|---|---|---|---|---|---|
| 1.0 *(assumed)* | 54.2% | 22.6% | 7.3% | 3.7% | **600K** |
| 0.9812 *(legs)* | 23.0% | 7.3% | **5.8%** | 17.9% | **400K** |
| 0.9424 *(interactive)* | **3.4%** | 14.0% | 18.2% | 40.0% | **200K** |

Both p_hit values are real measurements of real populations, and **the
answer moves across the whole candidate range between them.**

The tie is broken by a principle rather than a preference: **the p_hit
that matters is the one from the population where the threshold actually
fires.** No interactive session in the measured corpus ever reaches 200K —
0 of 93 — so the threshold never fires for them and their hit ratio has no
bearing on choosing it. Every cost consequence of this number is borne by
long autonomous runs, whose measured p_hit is 0.9812.

**The default is 400K.**

### The finding that outranks the number

This is the third independent refinement of the same model — better rule,
measured shapes, measured cache — and it produced a third different
answer: 200K, then 300K, then 400K. Each refinement was correct and each
moved the result somewhere else in the band.

**That is the result.** The model bounds a region — 200K to 600K, with
never-compacting worse than every point in it — and does not identify a
point within it. The default is the least-bad choice under the best
parameters currently measured, from the population that bears the cost.
It is a knob, it rests on one observed session above 400K out of 300, and
no further arithmetic on these logs will settle it.

Closed until the post-launch measurements: post-compaction re-read volume,
and a wider sample of long autonomous runs.

## How it will be measured, and what the measurement can and cannot say

**Functional first, effects reported.** The gate is behaviour, not
improvement:

1. the threshold fires at the **next settled round** and nowhere else;
2. the reserve guard fires **before the send** that would exceed
   `window − reserve`, and with a reserve at least the requested output;
3. an overflow **recovers** — one compaction, one retry, the run
   continues — and retries **exactly once**, never twice;
4. the recent tail **survives** all three paths;
5. no compaction ever lands **inside** a round that has an outstanding
   tool call or a stream in flight;
6. with the threshold never crossed and no overflow, behaviour is
   **identical to today's**;
7. the summary call's **cached-token count ≈ the covered range**, read
   from the request dump — the prefix-identity requirement, gated on the
   money rather than on the shape of the request.

Those are yes/no and are the shipping condition. (6) is the one most
easily skipped and the one that protects every user this change is not
for. (3)'s second half matters as much as its first: a recovery that can
fire again is an unbounded spend, not a recovery.

**Effect sizes are reported and judged by nothing**, on the CTX-1 scaled
instrument. The honest statement up front: **this programme's paired cost
measurements at n=12 have a per-pair spread near 30 points and cannot
resolve an effect under about 20%.** Two ceremonies of the same change
disagreed by 22 points. So a cost number from this round will be reported
with its interval and will not be claimed as a win, and the round is not
sized to detect a small one.

## The shape this is measured against

The reference implementation does the same thing with three differences
worth stating, because two of them are choices and one is a weakness:

| | the reference | A1b |
|---|---|---|
| default | on | on |
| the number | provider-reported context size of the last assistant message, message-size estimate as fallback, with a stale-usage guard | the same, via the canonical total (§1a) |
| when it is checked | at the end of a turn — after the tool loop, before the next prompt | at **every settled round inside the run** |
| overflow | compact, then retry automatically | compact at the last settled round, retry **once** (§3) |

The first two rows are why §1a is written the way it is: the source of
the number is a solved problem elsewhere and there is no reason to solve
it differently.

The third row is the whole point of this ADR and the one place the two
shapes disagree. A check that runs between turns cannot help a run that
never reaches the end of a turn, which is the failure described at the
top of this document. Checking at every settled round is strictly the
stronger position, and it is the position that costs something — it is
why §1b (prefix identity) and §2 (the reserve guard) have to exist at
all.

## What this ADR does not decide

- **Phase-aware waiting.** An earlier draft of this decision had three
  tiers, with a soft tier that WAITED for a phase boundary. That only
  means something if phase detection works, and phase detection is a
  guess we cannot currently measure — so three tiers would have been
  three things to get wrong, two of them unverifiable. It is a FUTURE
  increment, and its precondition is stated so it cannot be adopted on
  taste: **an instrument that shows compaction at phase ends beating
  compaction at the next settled round.** Until that exists, the next
  settled round is the boundary.
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
- **A wider sample of long autonomous runs.** The default is currently
  decided by ONE observed session above 400K out of 300. Three more would
  say more than any further arithmetic on the existing ones.
- **A measurement of post-compaction re-read volume.** The cost model
  says the choice between 200K and 400K is worth between +2% and +19%,
  and that this one quantity decides which. Measure it and the threshold
  either stands on evidence or moves; it is the first thing to measure
  post-launch and the cheapest.
- **A measured cost regression that clears the noise.** Not a number
  inside the interval; one that a properly sized round separates from
  zero.
- **A simpler relief that reaches inside a turn.** If microcompact alone
  can be made sufficient, then the threshold path is one more thing to get
  wrong and should go. The reserve guard and the overflow recovery would
  still stand on their own: they answer the single jump and the hard stop,
  which microcompact does not.
