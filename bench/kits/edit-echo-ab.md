# Ready-kit — the edit-echo A/B (FROZEN BEFORE THE RUNS)

**Frozen** 2026-09-15, before any leg of this round has run.
**Criteria may not be edited after the first leg starts.** BM-1 §1: margins
are never tuned to the round under judgment.

## The question

Three 24-turn T6 sessions of ours against three of the reference
implementation's, same task, same model, same effort, showed:

| | total calls | edit | read | shell | failed |
|---|---|---|---|---|---|
| ours (3 legs) | 91 / 88 / 78 | 31 / 32 / 30 | 15 / 25 / 19 | 41 / 30 / 27 | 6 / 3 / 4 |
| theirs (3 legs) | 61 / 61 / 66 | 24 / 24 / 25 | 5 / 8 / 11 | 32 / 29 / 30 | 4 / 0 / 0 |

The gap decomposes to **read (+11 median) and edit (+7); shell is a wash.**
67-84% of our reads are of a file the session had already edited, against
36-50% of theirs, and almost none are of a file unchanged since the last
read — they track the edits rather than being stale re-reads.

The one MECHANICAL difference found: what a successful edit returns.
Ours answers `edited <path>` and a revision token. Theirs answers a
success line plus the changed lines with numbers and context.

**Hypothesis.** A caller told only that an edit landed must read the file
to plan the next edit in it. A caller shown the changed lines does not.

**What is NOT established.** The within-arm variance is large — one of our
legs opened 19 of 24 turns with a read, another opened 4 — so this is
model behaviour that varies run to run, and the mechanism is a hypothesis
about its cause, not a measured cause. That is what this round is for.

## The arms

One binary, one difference. `KISO_EDIT_ECHO` is an A/B switch inside
`edit_file`, not a feature: the control arm is the SAME build with the
variable unset. No build difference, no model difference, no prompt
difference, no task difference.

- **A (control)** — `BENCH_EDIT_ECHO=0`
- **B (echo)** — `BENCH_EDIT_ECHO=1`

Held constant: kiso 0.36.0 local build, `deepseek-flash` via the DeepSeek
endpoint, `BENCH_EFFORT=high`, T6's 24 turns, `KISO_LEG_DEADLINE_S` and
`KISO_LEG_MAX_REQUESTS` at their defaults.

**n = 3 pairs, interleaved A1 B1 A2 B2 A3 B3**, serial, so provider drift
over the session falls on both arms of each pair. n = 3 is SMALL and the
verdict is reported as such.

## Validity gates — a leg that fails one is void, not a data point

1. `effort_bound` = `high` on every leg.
2. `edit_echo` = `off` on every A leg and `on` on every B leg. This is read
   back from what the leg's edit results ACTUALLY carried, never from what
   it was asked to do — `KISO_EDIT_ECHO=1` against a binary without the
   switch would produce a leg labelled B that behaved like A, and both arms
   would agree because they were the same arm.
3. `edit_echo` = `none` (the leg made no successful edit) is VOID, not
   `off`. A leg that did not edit cannot testify about editing.
4. `status` = complete. An incomplete leg is void.

## Pre-registered verdict

**Primary — the hypothesis.** Per-pair relative delta on `read_file`
calls, d_i = (B_i − A_i) / A_i.

> SUPPORTED iff median(d_read) ≤ −25% AND at least 2 of 3 pairs are
> negative.

**Guards — all three must hold for a SUPPORTED result to be proposable.**

- **Quality.** Every leg `verify=pass` under predicate 2 (contract AND
  boundary). Any B failure without a matching A failure is blocking.
- **Cost.** median per-pair cost-weighted delta ≤ +6% (BM-1's standing
  margin). **This is the real risk**: the echo puts lines into every edit
  result, and those lines ride in every subsequent request for the rest of
  the session. Fewer calls can still cost more. It must be measured.
- **Wall.** median per-pair wall delta ≤ +25% (BM-1).

**Secondary, recorded but not deciding**: total tool calls, edit calls,
failed executions, turns opened by a read.

## The decision, written down before the numbers exist

- **SUPPORTED + all guards** → propose shipping the echo unconditionally
  and deleting the switch. The owner decides; a proposal is not a release.
- **NOT SUPPORTED** → the obvious explanation was wrong. The switch is
  deleted, and the finding is recorded as a refuted hypothesis, with the
  read gap left open. It does not get re-run with looser criteria.
- **SUPPORTED but the cost guard fails** → the echo trades tool calls for
  tokens. Both numbers are reported with no default and no recommendation
  dressed as a finding; the owner decides.
- **Any validity gate fails** → no verdict. Fix the instrument, re-run.

## What this round cannot answer

Whether the echo helps on tasks unlike T6 (one small repo, three files, a
chain of small edits), and whether it helps a different model. Nothing
here generalises past that, and the report will say so.
