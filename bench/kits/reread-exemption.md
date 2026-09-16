# Kit — the re-read exemption round

**FROZEN BY THIS COMMIT. Nothing below is edited after the first leg
runs.** A criterion retyped later looks exactly like the original, which
is why `tests/criteria-agree.mjs` compares this file against the script
that applies it.

## The change under test

One bullet of `SYSTEM_PROMPT`, `apps/cli/src/index.ts`. Everything else in
both arms is byte-identical: same binary, same fixture, same 24 turns,
same effort, same model.

**Control (published):**

```
- Do not re-read a file you already read unchanged — rely on the earlier
  result.
```

**Arm:**

```
- Do not re-read a file you already read unchanged, or one you changed
  yourself through a confirmed edit — rely on the earlier result and
  on the change you just made.
```

`READ BEFORE YOU EDIT` is **not touched**. The first read of a file is
95% on our arm and 100% on the other; nothing argues against it, and a
round that deleted it would be measuring a different change.

## Why this clause

Tool discipline carries READ BEFORE YOU EDIT, and five bullets later an
exemption reaching only a file *already read unchanged*. A file the model
has just edited is not unchanged, so the exemption did not cover it and
the first rule applied. Read literally the pair instructs a re-read before
every repeat edit.

Measured on six T6 legs: the arm read before a repeat edit **62 times in
168 (36.9%)**; a build carrying neither rule read **16 in 128 (12.5%)**.
Both are equally redundant when they do it — the following edit's search
text was already in front of them 79% and 81% of the time. The difference
is frequency, not judgement.

## The primary metric, and the instrument that computes it

> **repeat-edit read-back rate** — of the edits to a file this leg has
> already edited, the share preceded by a `read_file` of that file since
> the previous edit of it.

`bench/readback-rate.mjs`, committed with three red proofs before this
kit was written, reproducing the baseline 62/168 = 36.9% and first edits
18/19 on the six legs. Its three properties: a failed call emits BOTH
`tool_result(isError)` and `tool_execution_failed` and is ONE call; a leg
with no repeat edit has NO rate (null, never 0%); the read window is
bounded by the previous edit of that file.

## Criteria — frozen before the first leg

### Two readings, both pre-registered here

The report states which reading it reached. Neither is chosen after
seeing the data.

**PRIMARY — "the sentence is most of the gap".**

| | |
|---|---|
| median per-pair relative delta on the per-leg rate | **≤ −50%** |
| what that means | 36.9% → ≤ 18.5%, between ours and the other arm's 12.5% |
| n | **22 pairs** |

**SECONDARY — "the sentence helps at a smaller size; ship is the owner's
judgement".** The bootstrap interval of the median **excludes zero**,
every guard green: **20,000 resamples, seed `20260916`, percentile
method, two-sided 95%.** A one-sentence change with all guards green is
low-risk enough that a real but smaller effect is the owner's call rather
than the round's to dismiss.

**The sign rule is REPORTED, never a bar.** At a true −50% shift a
two-thirds-negative rule asks the observed negative share to beat the
true one, which is a coin flip at every n — 59% power at n=9 and 50% at
n=24. A sign rule copied from a round with a tighter measure does not
carry; round A's did because its measure was far less dispersed.

### Why n = 22

The per-leg rate on the six existing legs is 25.0 / 26.9 / **80.0** /
33.3 / 41.4 / 20.7 — mean 37.9, sd 21.9, **CV 58%**, which is **2.4×**
what a binomial at ~28 repeat edits per leg would give. The legs
genuinely differ. Paired-delta CV ≈ 82%; 80% power on a −50% shift needs
22 pairs. An earlier draft of this round said n = 9, derived by pooling
every repeat edit into one binomial — an assumption those six numbers
refute.

**c3's 80% is carried as variance.** Six stratifiers were enumerated in
`kiso-doc/c3-stratifier-question-2026-09-16.md` **before the data was
consulted** — fixture variant, turn script, leg position, where repeat
edits begin, distinct files edited, an error before the window — and all
six are negative. The set is not extended after the fact and **no leg is
excluded under any reading.**

### Guards — any one failing BLOCKS, whatever the readings say

| guard | bar | why |
|---|---|---|
| quality | every leg `verify=pass` | a prompt that saves requests by doing less work is not an improvement |
| **stale-revision refusals** | **not above the control's, per leg** (today ~0) | THE hazard of this change: an arm told not to re-read editing on a view it should have refreshed. This class blocks on its own even with the overall share under 12% |
| overall refusals | refused share of edit calls **≤ 12%** (today 14/187 = 7.5%) | the second face of the same hazard |
| cost | median v2 delta **≤ +6%** | **THIS ROUND'S OWN CHOICE, stricter than BM-1.** `bm1-a1` — the default since the rel-030 freeze, Amendment 1 — is +20%; +6% is `bm1-frozen`, kept for re-reading old records. A change meant to save requests must not cost more, so this round holds itself to the tighter number by choice, not by BM-1's requirement |

The two refusal classes are separate mechanisms and are counted
separately: **pattern-not-found** is the search describing the file as it
would be — all 14 of today's refusals are that class, and none of them is
rescued by the other arm's fuzzy normaliser. **Stale-revision** is the
WR-1 guard firing on an unrefreshed view, and it is the one this change
could cause.

**Reported, never decisive:** requests per turn, total reads, reads before
first edits, replacement bytes per hunk, the sign count.

### Causal relevance (BM-1 rule 3)

A PROMPT round: the request-byte gates AND the paired bench BLOCK. Both
carry.

### The pins

`apps/cli/tests/pr1d-clause-pins.test.ts` is **not touched and owes no
DECLARED SUPERSESSION**: its five pins are the five texts measured
together as one combination — the reach section, the scope sentence, the
delivery sentence and the two shell texts — and this bullet is not among
them. The round carries the paired bench as the prompt tier requires, and
`apps/cli/tests/reread-exemption-pin.test.ts` asserts the changed bullet.
That pin was committed RED against the published prompt before the clause
moved.

## Cost

22 pairs at the measured T6 pair price: **$1.54, about 3.2 hours.**

## After the verdict — both paths, declared now

**If the PRIMARY passes:** the change ships as its own PR and release
**before the launch bench freezes**, so the launch build carries it. The
sequencing is the owner's.

**If only the SECONDARY is reached:** the report says so plainly and the
decision goes to the owner — a real but smaller effect on a one-sentence
change with every guard green.

**If neither:** the sentence stays as published, the round is recorded
NOT SUPPORTED, and the read-back stands as measured but unexplained. That
closes candidate C rather than parking it a second time.

## What this round cannot settle

- **A regex pin cannot certify meaning**, and the new pin says so about
  itself.
- **One fixture family.** T6's repo is four files; a repeat edit there is
  not a repeat edit in a large tree. The direction may generalise, the
  magnitude may not.
- **Causation beyond this sentence.** The other arm's build carries no
  read-before-edit rule and no re-read guidance at all. This round tests
  one sentence, not that difference.
