# Kit — the re-read exemption, REPLICATION

**PRE-REGISTERED. NOT FROZEN until the criteria binding is red-proved and
the prerun checklist is answered in writing. No leg runs before the
owner's own word, spoken to the executor.**

Supersedes the withdrawn version 2 (`reread-v2`), whose premise was
falsified before it ran —
`kiso-doc/reread-v2-premise-falsified-2026-09-16.md`.

## What this round is

**The SAME sentence as version 1, run again under criteria fixed from base
rates rather than from version 1's readings.**

Version 1 is recorded BLOCKED. It was blocked by a guard with two faults,
both the author's and both named in the ruling: sized per-leg absolute
against a base rate of about zero, and **one-sided by construction** — it
could fire on arm-above-control and was structurally deaf to the reverse.
The reverse is what the legs actually hold:

| | stale-revision refusals | repeat edits | rate |
|---|---:|---:|---:|
| version 1 arm | **2** | 606 | 0.33% |
| version 1 control | **3** | 582 | **0.52%** |

The arm that reads back cited stale slightly MORE often. The hazard the
guard was built against did not materialise above base rate, so the
sentence has not been tested against criteria that could pass it.

## The change under test

One bullet of `SYSTEM_PROMPT`, `apps/cli/src/index.ts`. Everything else
byte-identical.

**Control — the PUBLISHED prompt on `main`:**

```
- Do not re-read a file you already read unchanged — rely on the earlier
  result.
```

**Arm — version 1's wording, verbatim:**

```
- Do not re-read a file you already read unchanged, or one you changed
  yourself through a confirmed edit — rely on the earlier result and
  on the change you just made.
```

`READ BEFORE YOU EDIT` untouched. The read-window contract is NOT in this
round: ruled post-launch, `reread-round-ruling-2026-09-16.md` §7.

## Primary

| | |
|---|---|
| metric | repeat-edit read-back rate, per leg, `bench/readback-rate.mjs` |
| **bar** | median paired relative delta **≤ −30%** AND the bootstrap 95% interval of the median **excludes zero** |
| n | **12 pairs**, serial — no concurrency is added; execution shape is protocol |
| bootstrap | 20,000 resamples, seed `20260916`, percentile, two-sided 95% |

Both conditions, not either.

**The sign rule is REPORTED, never a bar** — carried forward from version
1 and still true: a rule demanding some fraction of pairs be negative asks
the observed negative share to beat the true one, which is a coin flip at
every n. The negative-pair count is printed and gates nothing.

## Guards

| guard | bar |
|---|---|
| quality | verify=pass, or misses only in the **frozen empty-input class** listed below |
| cost | median v2 delta ≤ **+6%** — **THIS ROUND'S OWN CHOICE, stricter than BM-1**: `bm1-a1`, the default since the rel-030 freeze, is +20%; +6% is the retired `bm1-frozen`. A change meant to save requests must not cost more, so this round holds itself to the tighter number by choice |
| wall | median delta ≤ **+25%** |
| edit refusals | arm refused share of edit calls ≤ **12%** |
| **stale revision — SIZED and TWO-SIDED** | see below |

### The frozen empty-input class, carried verbatim from version 1

Version 1's DECLARED SUPERSESSION closed this list at eight, and it is
reproduced here rather than referenced: a kit that sends the reader
somewhere else for its own bar is a kit whose bar can drift unnoticed.

`parseRangeList('')` · `sumOf(startsOf(''))` · `startsOf('')` ·
`totalSpan('')` · `mergedText('')` · `hasOverlap('')` ·
`countDistinct('')` · `longestRun('')`

The held-out boundary's other ten checks are other classes and still
block. The list does not grow to fit whatever fails next; the criteria
test holds it closed at eight.

**Where this exemption came from, carried with it.** It was proposed by
version 1's kit author **AFTER an inconvenient result** — a leg failed on
this class mid-round — and **adjudicated by the lead, who is not rescued
by it**, against the test "would it have been accepted written before the
first leg". It rests on the class being a fixture trap both products and
both arms fall into: `pi-T6-r2` (the other product), `tool-table-a/ctl5`
(ours, the control), `reread/a4` and `reread/a7` (ours, the arm). The
arithmetic that should have preceded version 1's freeze is recorded with
it: one such failure in 18 legs means **under one in ten** chance of 44
clean, and a per-leg absolute guard is sized against the known base rate
before it is frozen.

### The hazard guard, written so it cannot repeat version 1's fault

1. **A verify miss after a stale-revision refusal BLOCKS.** That is the
   harm: a wrong write, or a task left broken.
2. **Otherwise the paired counts are reported against a tolerance on
   `|arm − control|` ≤ 1.0 pp over the round.** The absolute difference,
   not the signed one — a guard that can only fire in the direction its
   author feared is not a guard, and version 1's could not see its own
   control exceeding its arm.
3. **Exceeding the tolerance with every verify passing is a FINDING for
   the lead, never an auto-block.**

**Why two-sided, recorded at the lead's instruction.** Two reasons, and
the second is not the author's:

- **It costs no power.** This metric is report-only — nothing but rule 1
  blocks on it — so making the comparison two-sided removes the structural
  blindness without weakening anything. Version 1's guard could fire only
  in the direction its author feared, and the legs held the other
  direction: control 3 stale refusals to the arm's 2.
- **A large REDUCTION would be as surprising as a large increase**, and
  deserves reading rather than silence. If the arm cites stale materially
  LESS often than the control, that is a fact about the sentence too, and
  a one-sided guard would have thrown it away.

**The tolerance is justified without reference to version 1's rate.** A
stale-revision refusal that a leg recovers from produces no wrong write;
it costs the refused call and the retry. At 1.0 pp of repeat edits — about
28 per leg — that is roughly 0.14 extra request pairs per leg, which is
below the noise on any cost measure this programme has. The harm that
justifies blocking is the verify miss, and that is rule 1.

## Reported, never judged

1. **The revision-source diagnostic per leg** — `bench/reread-rev-source.mjs`:
   for every repeat edit, whether `expectedRevision` matched the last
   receipt's rev, the last read's rev, both (they coincide after a
   read-back, and conflating that with "receipt" invents evidence), or
   neither.
2. **The provenance of every "neither" case, in BOTH arms** — how many
   turns back the cited rev came from, and whether it came from a read
   result or an edit receipt. Version 1 had 2 in each arm and this is the
   only way the count becomes a mechanism rather than a lead (RV-1).
3. **Refusals split by class, per arm.** Version 1: arm 69 against control
   43. The excess is the PATTERN class — about 1.2 extra refusals a leg —
   and it is **the true cost of editing without a fresh view**. It is
   stated to the owner in those words, net of the cost movement, not
   buried.

## Void legs, and no leg excluded

Arm identity is read from each leg's OWN first captured request body
(`prompt_arm`), never from the build path the runner was handed. **A leg
whose bodies carry a prompt other than the one launched is VOID and stops
the scoring**; the verdict script refuses the round rather than scoring
around one. **No leg is excluded for what it measured** — a leg discarded
is a leg the apparatus broke, and it is preserved with its reason, as
version 1's pair 4 was.

## Before the freeze

1. `bench/tests/test_reread_replication_criteria.mjs` binds this kit to the
   verdict script, red-proved from BOTH sides as version 1's was.
2. The prerun checklist, answered in writing.
3. **The owner's own word, to the executor.** Relayed approval does not
   buy legs, and the target has changed once already.

## Cost

12 pairs at the measured T6 pair price: **about $0.9, 1.5 hours**, serial.

## After the verdict

**Primary met, guards green:** the change ships as its own PR and release
before the launch bench freezes; sequencing is the owner's.

**Primary met, tolerance exceeded with verifies passing:** reported as a
finding, the lead rules. Neither an auto-block nor an auto-ship.

**Primary not met:** the sentence stays as published, and the finding that
the prompt drives the read-back — established by version 1 and not in
dispute — stands independently of the wording being refused twice.
