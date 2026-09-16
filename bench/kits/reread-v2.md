# Kit — the re-read exemption, version 2: the receipt's revision

**PRE-REGISTERED. NOT FROZEN UNTIL THE INSTRUMENT BELOW IS BUILT AND
RED-PROVED. No leg runs before the owner's own word.**

## Why there is a version 2

Version 1 is recorded BLOCKED in `kiso-doc/reread-round-result-2026-09-16.md`.
It worked — median read-back delta −44.8%, cost index −17.3%, bootstrap
95% of the median [−58.9%, −27.6%] — and it carried the harm its own kit
had named: two arm legs, and no control leg, produced

```
edit_file: … changed since rev:… — read it again and cite its [rev:…] line
```

The model stopped re-reading, its revision went stale, and the
precondition refused the write. **The read-back it removed was doing a
job: keeping the revision current.** Version 1 removed the job without
replacing it.

Version 2 replaces it. The product already returns the new revision on a
successful edit; the sentence tells the model to carry it forward.

## The change under test

One bullet of `SYSTEM_PROMPT`, `apps/cli/src/index.ts`. Everything else
byte-identical, as before.

**Control — the PUBLISHED prompt** (not version 1's arm; version 1 does
not ship and is not a baseline):

```
- Do not re-read a file you already read unchanged — rely on the earlier
  result.
```

**Arm:**

```
- Do not re-read a file you already read unchanged, or one you changed
  yourself through a confirmed edit — a successful edit returns the file's
  new [rev:…], and your next edit to that file cites the newest rev you
  hold, from a read or from an edit receipt.
```

`READ BEFORE YOU EDIT` is untouched, as in version 1.

**Not in this round:** the read-window contract (an absent `limit` reading
to EOF, the continuation note naming no limit, a character soft cap). Its
cost direction is unmeasured and bundling it would make any result
unattributable. Counted free in
`kiso-doc/read-continuation-count-2026-09-16.md`.

## Primary

| | |
|---|---|
| metric | repeat-edit read-back rate, per leg, `bench/readback-rate.mjs` |
| **bar** | median paired relative delta **≤ −30%** AND the bootstrap 95% interval of the median **excludes zero** |
| n | **12 pairs** |
| bootstrap | 20,000 resamples, seed `20260916`, percentile, two-sided 95% |

**Both conditions, not either.** The −30% is fixed from version 1's
observed interval lower bound, before this round runs — it is not a bar
chosen after seeing version 2.

## Guards

| guard | bar |
|---|---|
| quality | verify=pass, or misses only in the **frozen empty-input class** carried forward verbatim from version 1's DECLARED SUPERSESSION |
| cost | median v2 delta ≤ **+6%** — this round's own stricter choice, as before; `bm1-a1` is +20% |
| wall | median delta ≤ **+25%** |
| edit refusals | arm refused share of edit calls ≤ **12%** |
| **stale revision — SIZED, not absolute** | **blocks only when a leg carrying a stale-revision refusal also FAILS verify.** Otherwise the paired counts are reported against a tolerance of **arm ≤ control + 1.0 pp over the round**; exceeding that with every verify passing is a FINDING FOR THE LEAD, not an auto-block |

**Why the hazard guard is sized this round.** Version 1's was per-leg
absolute against a base rate of about zero, which is the same
mis-sizing as its quality guard — recorded as the lesson both times. A
stale-revision refusal that the arm recovers from, with verify passing,
costs a request; one that ends in a failed verify is the harm. The guard
now separates them.

## Diagnostic — reported, never judged

For every repeat edit in an arm leg: did `expectedRevision` equal

- the rev from the last **edit receipt** for that file,
- the rev from the last **read** of that file,
- or **neither**?

This is what tells us whether the sentence was followed. It gates nothing.

## Before the freeze

1. `bench/reread-rev-source.mjs` — the diagnostic instrument, with red
   proofs, committed; a receipt rev and a read rev must be told apart on
   constructed streams before any leg runs.
2. `bench/tests/test_reread_v2_criteria.mjs` binds this kit to the verdict
   script, red-proved from both sides, as version 1's was.
3. The pre-run checklist, answered in writing.
4. **The owner's own word.** Relayed approval does not buy legs.

## Cost

12 pairs at the measured T6 pair price: **about $0.9 and 1.5 hours**,
serial. **No concurrency is added** — execution shape is protocol, and
version 1 ran serial.

## After the verdict

**Primary met, guards green:** the change ships as its own PR and release
before the launch bench freezes. Sequencing is the owner's.

**Primary met, stale-revision tolerance exceeded with verifies passing:**
the round reports it as a finding and the lead rules; it does not
auto-block and it does not auto-ship.

**Primary not met:** the sentence stays as published. Version 1 already
established that the prompt drives the read-back; what would then be
refused is the second wording, not the finding.
