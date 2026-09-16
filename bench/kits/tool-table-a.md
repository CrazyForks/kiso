# Ready-kit — round A, the default tool table (FROZEN BEFORE THE RUNS)

**Frozen** 2026-09-16, before any leg. Criteria may not be edited after the
first leg starts; margins are never tuned to the round under judgment.

## The caveat, first, because it limits everything below

The T6 fixture's `tests/range.test.js` **hands the model the entire final
contract of the 24-turn chain at turn 0**. No real repository gives an
agent the complete specification of its next twenty-four tasks in one file.
The capture round found that reading it costs us 3,107 tokens of thinking
against the other arm's 504 — and that magnitude is plausibly the
fixture's, not the product's.

**So A's result is about the default tool table on this task. It is not a
prediction of the launch numbers**, and the report says so wherever the
number appears.

One further asymmetry to note rather than remove: our tool results carry a
`[rev:…]` trailer and theirs carry nothing equivalent. It is ~23 bytes on a
read. It is the only tool-result byte difference between the arms, it is
ours only, and it is not what A changes.

## The question

Our default table carries **7 tools and 5,566 bytes of schema**; the
reference implementation's carries **4 and 2,900**. The bytes are cached
and cost almost nothing to send; what differs is what sits in front of the
model on every request.

The census over **every kiso leg on disk — 65 legs, 3,668 tool calls, all
rounds, both scenarios** — says which of ours earn their place:

| read_file | 1392 | 37.9% |
|---|---:|---:|
| shell | 954 | 26.0% |
| edit_file | 810 | 22.1% |
| search_text | 359 | 9.8% |
| list_dir | 124 | 3.4% |
| write_file | 29 | 0.8% |
| **delegate** | **0** | **0.0%** |

`search_text` and `list_dir` EARN THEIR PLACE and are not touched — an
earlier reading off T6 alone put them at 1.6% and 0.8% and would have cut
two useful tools; the wider base corrected it. `write_file` is low because
both fixtures ship every file they need, a fixture property and not a tool
verdict. `ask_user` is **not in the table at all** on a piped leg (no panel
bridge), so it is not a default-table question and is not counted as one.

`delegate` is in the table on every request and has **never once been
selected, in 3,668 opportunities**.

## The arms — ONE difference

- **Control** — the default table as it ships: 7 tools.
- **A** — the default table **without `delegate`**: 6 tools.

The subagent extension remains loadable by configuration. **This is a
question about the DEFAULT, not about the tool.**

Everything else byte-identical: the same prompt, the same shell text, the
same model, the same endpoint, `BENCH_EFFORT=high`, the same 24 turns, the
same packed build. The surround has two large differences (table and
prompt) and this round isolates ONE.

## How n was chosen — the arithmetic, before the runs

Reasoning per request across our three capture legs, same configuration,
pure replicates: **94.7 / 167.3 / 109.1**, mean 123.7, sd 38.4, **CV 31%**.
Two independent draws, so a per-pair relative delta carries roughly
**±44%**.

| effect to separate | pairs needed |
|---|---:|
| 10% | 75 |
| 20% | 19 |
| **30% (1.3× against 1.0×)** | **9** |
| 50% | 3 |

**n = 9 pairs.** That is what separates 1.3× from 1.0×, and it is the
smallest effect worth acting on: below it the change is not worth a
product decision even if real.

The frozen verdict is a median-and-sign rule, not a t-test; the table above
is the SCALE of n, never a substitute for the rule.

**The previous two rounds were sized at n = 3 and neither could resolve
what it was built to measure.** That is why this arithmetic is in the kit
rather than in a report afterwards.

## The runs

Paired T6, **9 interleaved pairs, ABBA**, capture ON for both arms
(`KISO_DUMP_REQUESTS` on ours, the proxy on the other — a loopback base URL
defeats our endpoint-keyed metadata lookup and would leave every leg
`effort_not_bound`), the build packed and installed from main, effort
**wire-verified per leg on both arms**.

## Pre-registered verdict

**Primary, two lines reported together:**
1. **reasoning tokens per request**, per-pair relative delta d = (A − ctl)/ctl
2. **v2 cost index** (F + 0.02H + 4O), same form

> A is SUPPORTED iff median(d_reasoning) ≤ −30% AND at least 6 of 9 pairs
> are negative.

**Guards, all required:**
- **verify 100%** under predicate 2 on every leg. A quality failure blocks.
- **v2 must not rise beyond +6%** (BM-1's standing margin).
- **requests per turn** reported per arm, not gated.

**Validity, per leg:** status complete; effort wire-verified on both arms;
the capture reconciles (one body per recorded request, model matching);
`delegate` **absent from A's table and present in the control's**, read
back from the captured bodies rather than from what the runner was asked
to do.

## The decision, written before the numbers exist

- **SUPPORTED + guards** → propose removing `delegate` from the default
  table. **The owner decides**; a proposal is not a release. The proposal
  states, in its first line, that the bench has never had a delegable
  subtask — "never selected here" is not "not useful".
- **NOT SUPPORTED** → the default table is not what moves the thinking on
  this task. `delegate` stays, and the reasoning gap keeps its open
  candidates. It is not re-run with a looser bar.
- **SUPPORTED but a guard fails** → both numbers reported, no default, no
  recommendation dressed as a finding.
- **Any validity gate fails** → no verdict. Fix the instrument, re-run.

## Cost

Measured from the capture round's own six T6 legs, not estimated:
**$0.035 per leg**. Eighteen legs = **$0.63**, and **~96 minutes** serial.
