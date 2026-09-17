# ADR-0054: The default tool table — what is always present, and what deferral is reserved for

- **Status:** **Accepted** — ratified by the owner on 2026-09-16, in their
  own words, directly, on the draft below. The decision itself was taken
  the same day and reached this draft through the lead; ratification is
  the owner's own act and they took it.
- **Date:** 2026-09-16
- **Layer:** the CLI's built-in extension layer and the coding tool set
  (`packages/tools-node`). **Zero code diff** — this ADR records a decision
  about a default and changes nothing today.

## Context

A session's default tool table carries seven tools — `read_file`,
`list_dir`, `search_text`, `write_file`, `edit_file`, `shell`, `delegate` —
and an eighth, `ask_user`, only when a panel bridge exists. A piped,
headless session therefore never sees `ask_user`: no bridge, no eighth
tool, and its table cannot offer a question nobody could answer.

Two questions were open. Does each tool earn its place? And does the SIZE
of the table cost anything — the decision-load hypothesis, that more
options in front of the model on every request make it deliberate more.

### Usage is a property of the task set, not of the tool

Tool calls counted from durable logs across three populations. Percentages
are of each population's own total.

| tool | round A control arm | benchmark history | real sessions |
|---|---:|---:|---:|
| `read_file` | 27.8% | 27.1% | 30.0% |
| `shell` | 35.5% | 31.4% | 23.4% |
| `edit_file` | 34.3% | 33.4% | **1.9%** |
| `list_dir` | **1.7%** | 4.0% | **30.0%** |
| `search_text` | **0.7%** | 3.4% | **12.5%** |
| `write_file` | 0.0% | 0.7% | 0.6% |
| `ask_user` | n/a (no bridge) | n/a | 1.1% |
| `delegate` | **0.0%** | see below | 0.5% |

- **round A control arm** — 9 legs, 820 calls. The narrowest and best
  evidenced: each leg's table is recorded in its own `tool_table` sidecar
  and every one of these nine reads back all seven tools.
- **benchmark history** — 481 legs, 11,993 calls, every benchmark leg on
  disk back to 0.5.0.
- **real sessions** — 96 sessions on the owner's machine, 1,355 calls.

**No tool is low in every population.** `search_text` reads as 0.7% in the
control arm and 12.5% in real sessions — an 18× spread. `list_dir` is 1.7%
and 30.0%. `edit_file` inverts: 34.3% in the benchmark, 1.9% in real
sessions. The benchmark is a coding fixture, so it edits and rarely
searches; the owner's sessions are largely exploration and review, so they
search and list and rarely edit. **A single population cannot retire a
tool**, and the one reading that makes `search_text` look negligible is
the one taken from four files with nothing to search.

`write_file` is the honest exception: 0.6–0.7% everywhere. It is kept on a
capability floor, not a frequency argument — it is the only way to create
a file, and both benchmark fixtures ship every file they need.

### What `delegate`'s zero does and does not say

`delegate` is never selected in the benchmark. Two separate reasons, and
only one of them is evidence:

- Most of the 481 historical legs **predate the tool** — it shipped in
  0.30.0 — so their zero says nothing at all.
- The nine control legs of round A **did carry it**, verified from each
  leg's own sidecar rather than from what the runner was asked to do. It
  was offered on every request across 820 calls and selected zero times.

That zero is real, and it measures **the task set**: the benchmark has
never contained a delegable subtask. The only evidence of real use is the
owner's own sessions — **5 sessions, 7 calls** out of 96: deep exploration
of a package, a code review, a completion audit, structural-debt analysis
three times, a multi-file read. Rare, real, and substantial each time.

**The two populations must not be pooled.** The benchmark's zero is a
statement about fixtures; the 7 real calls are a statement about the
product.

### Whether the table's size costs anything

Measured, not argued. A nine-pair paired round — criteria frozen in the
kit before the first leg — compared the full table against the same table
without `delegate`, one environment variable apart on the same binary,
everything else byte-identical. Arm identity was read back from each leg's
own recorded table, never from the runner's intent.

**NOT SUPPORTED.** Per-pair reasoning-per-request deltas: −40.8, +27.6,
+32.1, −31.6, −42.3, +10.0, +44.0, −14.6, +175.8. Median **+10.0%**
against a pre-registered bar of ≤ −30%; **4 of 9** negative against a need
for 6. The sign is wrong and the magnitude is absent. The cost guard moved
the other way (median v2 −11.8%) but does not clear its own noise either.

The round's own arithmetic held: it estimated ±44% noise on a paired delta
from three replicate legs before running, and observed 68%. n = 9 was
sized to detect a 30% effect; the real effect is smaller than that, which
is the finding rather than a failure of the round.

One control leg's verify failed, so the round's quality guard failed and
the script reports **BLOCKED**. Both readings land in the same place: with
the primary's direction wrong, nothing about the table was proposable
either way.

## Decision

1. **The default table stays as it is.** Six coding tools plus `delegate`
   are always present; `ask_user` remains conditional on a panel bridge.
   Nothing is removed.

2. **`delegate` and `ask_user` are DEFAULT CAPABILITIES and must never
   require manual configuration.** A capability a user has to discover and
   enable is a capability most users do not have.

3. **Tool count is not a reasoning lever, on the evidence we have.** The
   decision-load hypothesis was measured and not supported, so it is not a
   reason to change the table.

4. **The projection idea is moot, not pending.** Folding `read_file`,
   `list_dir` and `search_text` behind one model-facing tool was a
   hypothesis about decision load, explicitly gated on this round: if
   removing an unused tool moves nothing, tool count is not the lever. It
   is closed until a different premise revives it.

5. **Deferred loading is RESERVED, not applied.** It remains the right
   mechanism for a long tail — a capability brought into the table on
   demand through a small discovery tool, automatically, never by hand.
   The case for applying it is not present at seven tools and does not
   rest on reasoning cost. **It becomes live when a table grows beyond what
   a default can carry; an MCP-heavy workspace is the expected trigger.**

## When to overturn this

- **An MCP-heavy table.** Seven built-ins are not the binding case; a
  workspace whose MCP servers add dozens of tools is. Reaching that is a
  reason to revisit point 5, not to re-litigate points 1–4.
- **A measured reasoning effect at larger n.** This round could detect a
  30% effect and found none. A 10% effect would need roughly 75 pairs and
  is not worth that spend today — but a round that measured one would
  overturn point 3, and with it point 4.
- **A benchmark that can exercise `delegate` and still reports zero.**
  Today's zero measures the fixtures. A task set containing a genuinely
  delegable subtask would make that zero mean something.

## What this ADR does not decide

The read window — recorded separately as RW-1: 42.6% of reads in real
sessions truncate at 200 lines, and in 67% of those the model does not read
on. Whether that partial view HURTS is not established, and call counts
cannot establish it; the step that would is a quality comparison over
sessions already on disk. Referenced here so a later reader does not
mistake this ADR's silence for a ruling on it.
