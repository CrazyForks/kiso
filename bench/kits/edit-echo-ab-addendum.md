# Addendum — what this round cannot measure, found after it started

**Written 2026-09-15, after leg b1 completed. The kit itself is NOT edited:
a frozen document stays frozen, including when the new fact is unflattering.
This is a separate file so the freeze and the discovery are both on the
record, in that order.**

## The build under test lacks two metering features

`KISO_VERSION=0.36.0-ab.local` is built from `fix/image-echo-keeps-the-index`,
which is level with main. Two features the programme built earlier this week
live on `bench/effort-alignment` and are NOT in main:

- `Usage.reasoningTokens` — the split of the output that was thinking
- `Usage.servedModel` — the model id the server says it served

Both are METERING. Neither changes what the agent does, so the A-versus-B
comparison — one binary, one switch — is unaffected and the frozen criteria
all remain measurable. What is lost is two things I would have wanted:

1. **Whether the echo changes how much the model THINKS.** This is the
   question the standing review actually asked (keep the effort high, remove
   the wasted work), and this round cannot answer it. The legs' usage events
   carry no `reasoningTokens` field at all — absent, not zero.
2. **Verification that both arms were served the same model.** The arms are
   interleaved within minutes on one endpoint with one model id, and pairing
   is what controls for drift, so the risk is small. It is not the same as
   having checked.

## What follows from it

- **This round's legs are not comparable to the paired round's.** Those ran
  a binary built from the other branch. Different builds, different records;
  a cross-round delta would be measuring the branch, not the switch.
- **The round was NOT restarted to gain these.** Neither is in the frozen
  criteria, switching builds mid-round would void the legs already run, and
  one round runs one binary. Restarting to add a measurement the verdict
  does not turn on is scope drift that costs real money.

## The thing this exposes, which outlives the round

PR #40 has been waiting on re-review, and the metering it carries —
served-model recording, the reasoning split, the whole-leg coverage
reconciliation — is the foundation the bench programme now depends on.
While it sits unmerged, **any build cut from main cannot measure them**, and
this round is the first concrete cost of that.
