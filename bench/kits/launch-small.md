# Kit — the small launch bench, kiso vs the reference implementation

**Pre-registered.** This file is committed before the pilot, and frozen by
a later commit before the first scored leg. Nothing below is changed after
a scored leg has run. The plan and the lead's rulings are in kiso-doc:
`plan-launch-bench-small-2026-09-19.md` and the lead's approval of it.

## What is compared

| | kiso | the reference implementation |
|---|---|---|
| artifact | 0.40.0, named by its commit AND the sha256 of each packed tarball (filled in at the freeze) | pi 0.84.2, the version probed on every leg |
| install | the packed tarballs, `npm install -g`, `KISO_BIN` pointing at the bin | the installed `pi` |
| model | official DeepSeek `deepseek-flash`, the served model read back per leg | same |
| effort | `high`, bound (`/model ds high`, durable profile) AND read from the wire | `high` (`--thinking high`), read from the wire |
| configuration | bare: per-leg HOME, `env -i`, no extensions/skills/MCP of the operator | bare: per-leg HOME, `env -i`; its model store is the one DECLARED file (the capture proxy's base URL) |

**What each arm reads by design, stated symmetrically:** kiso reads
`AGENTS.md`/`CLAUDE.md` in its cwd only; the reference implementation reads
`AGENTS.override.md`/`AGENTS.md`/`CLAUDE.md` in every ancestor up to `/`.
Under this bench's isolation both read only what the fixture itself
carries (finding LB-1).

## Where legs live, and the gates every leg passes before a request

- Legs live under `/private/tmp/kiso-launch-bench/runs/<round>-<part>/<leg>`.
  No ancestor carries an instruction file (checked), and the directory
  pattern is fixed for the whole round.
- Each leg's repo is its own git repository with one baseline commit.
- **Before the first request, two gates run (`leg-isolation.sh`):**
  1. `git -C <leg repo> rev-parse --show-toplevel` equals the leg repo.
  2. No ancestor holds `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md` or
     `.kiso`.

  Either failing makes the leg VOID, and the runner exits before the
  credential is read.
- **A concealed instance is STAGED.** The leg sees `fixture/` and
  `tasks.json` only. The verifier (including the reference solution) is
  materialized from the seed after the arm exits, and deleted after the
  verdict. Generation is deterministic, which the offline smoke checks.

## The schedule

**Part 1: axis 3**, 12 interleaved pairs per series (`run-launch.sh t5 1 12`,
then `t6 1 12`):
- T5 is the cross-file task, 8 turns, with the mid-way `/compact` off.
- T6 is the long session, 24 turns in 4 buckets.

**Part 2: the concealed set** (`run-launch.sh concealed 1 24`):
- 24 pairs: families A, B+D, C and E, with 6 instances each.
- The order is fixed and round-robin by family:
  `A-1 BD-1 C-1 E-1 A-2 BD-2 C-2 E-2 … A-6 BD-6 C-6 E-6`.

**Order within pairs:** odd pairs run kiso first; even pairs run the
reference first.

**Family F is not scheduled** (the lead's ruling (a)):
- It is non-comparable at launch: there is no frozen native recovery
  procedure for the other arm (freeze-gate item 7).
- F favours OUR arm, so dropping it does not bias the set toward us.
- The shape is untouched: no shape file changes, both hashes stand, and
  `check-shape --seed` and `self-check --seed` run on all five families.
- The report says all of this.

**Caps.**
- Requests, per part, summed from each leg's own ledger:
  - T5: 1,400 (measured 1,260);
  - T6: 2,800 (measured 2,616);
  - concealed: 1,800, which is the remainder of the owner's 6,000.
- Per leg: the runners' deadline and request ceiling (defaults: 1,800 s,
  200 requests).
- A part that reaches its cap stops before its next pair and is
  **INCOMPLETE**: its legs are reported, and there is no comparative
  figure. Partial runs are archived anyway.

## Validity: a leg is VOID when it cannot say what it ran

A VOID leg is reported and never rescored; its pair has no delta. A leg is
VOID when any of these holds:
- **Isolation:** a gate fails.
- **Effort:** the wire shows an effort other than `high`. For kiso, the
  durable profile must also show it bound, otherwise the runner marks the
  leg `incomplete:effort_not_bound`.
- **Capture:** it does not reconcile. That means FEWER bodies than
  recorded requests, a body naming another model, or a body without the
  effort.
  - MORE bodies than recorded requests is a retry or an unbilled call. It
    is **reported** (`extra_calls`) and does not void the leg.
- **Arm identity:** the leg's own bodies say another arm wrote them (ours
  are dumped as `req-<pid>-<seq>`; the other arm's are proxied as
  `req-<n>`).

## Reported per leg, never silently absorbed

- **kiso's own records:**
  - any `decidedBy: floor` or `read-only-shell` decision;
  - any compaction (`summarized`/`microcompacted`; zero is expected, and
    a fire is reported, not voided);
  - any abandoned draft (a mid-stream retry).
- **Both arms:**
  - extra captured calls (an in-place retry);
  - the served model;
  - the wire effort.
- **Usage:** unknown is never zero. A leg with an unknown usage field
  stays in the table, marked, and its pair has no cost delta.
- **Cost v2 is `F + 0.02·H + 4·O`.** The provider's output includes
  reasoning on both arms (checked on real records), so reasoning is in
  cost v2 for both.

## The report (`launch-report.mjs`): descriptive, no bar

**Per part, and per concealed family, per arm:**
- verify passes of the valid legs;
- the median of cost v2;
- the median wall time;
- the median request count;
- void and unknown-usage counts.

**Across pairs:**
- the median of `d = (kiso − reference) / reference`, for cost and for
  wall;
- a 95% percentile-bootstrap interval of each median (seed `20260919`,
  20,000 draws).

**There is no pass/fail threshold and no marketing verdict.**
- The report states what it measured.
- Every family carries its `favours` label, and B+D states its small
  space ("B+D is small, and says so").

**The report also carries:**
- the tested artifact's commit and tarball sha256s;
- pi's version;
- both seed draws and their `check-shape --seed` outputs (the ceremony
  doc);
- the `self-check --seed` verdicts;
- the F statement.

**What the launch report may quote:** numbers from this isolated bench
only.

## The artifact rule

If a change on the request path merges after the seed draw (the prompt,
the tool table, compaction, a provider), the bench is either:
- re-run on the new artifact, or
- the change ships as 0.40.1.

A UI-only fix may ship in 0.40.0, with the report naming the commit this
bench tested.

## The seed

- The owner draws it at the freeze and holds it.
- The ceremony is `kiso-doc concealed-seed-ceremony-2026-09-18.md`:
  `check-shape --seed`, at most one redraw, then `self-check --seed`
  before any scored leg.
- At run time it is read from `LAUNCH_SEED` and never written into the
  tree.
- **Custody is stated, not claimed as containment.** The arms run as the
  operator's user, and the generator does not sit in any leg.

## The pilot, before the freeze (on the owner's word)

- **Scope:** four pairs, one per runner PATH, on a THROWAWAY seed (never
  the real one):
  - T5;
  - T6;
  - family A (the multi-turn native-session mechanism on both arms);
  - family E (`answer.txt` from each arm's own record).
- **Cost:** about $0.15.
- **Criteria:**
  - every leg is non-void;
  - the effort is `high` on the wire for both arms;
  - the capture reconciles;
  - the arm identity matches;
  - usage is read (non-empty);
  - `answer.txt` is non-empty and is the FINAL assistant text, read back
    by eye for both arms on A and E.
- **An empty answer or an empty usage set is a failed read, not a result.**

## Optional, the owner's decision: the recovery self-test

- One arm only, and not a comparison.
- It is family F on kiso: the concealed falsification test of the README's
  crash-recovery claim, about $0.15.
- It runs after parts 1 and 2 complete, and only if time remains.
- It is reported in its own section and never mixed into any comparative
  number or headline.

## Archive

After the scored legs, the round directory is archived with a sha256
manifest, together with the ledgers and the report. The archive covers
every leg directory: the bare home, the capture, the session records, the
sidecars.
