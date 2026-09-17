# ADR-0056: MCP servers get one resident line, not every schema, above a declared budget

- **Status:** DRAFT — for the lead's review, then the owner's ratification.
  Nothing is built.
- **Date:** 2026-09-17
- **Layer:** `extensions/mcp` only. No kernel change, no change to the
  built-in tools.

## The hazard, first

**This ADR proposes hiding tools from the model.** A tool the model cannot
see is a tool it cannot choose, and the failure mode is not an error — it
is a worse answer, with nothing in any log saying a capability was
withheld. That is strictly worse than a visible failure, because no gate
catches it.

Three things follow, and they are the design, not caveats on it:

1. **Built-ins never defer.** The six tools below are how the product
   works at all; there is no budget under which they disappear.
2. **Deferral is never silent.** Every deferred server keeps **one
   resident line** naming it and what it is for. The model always knows
   the capability exists.
3. **Admission is append-only.** `load_tools` adds schemas to the live
   request and never removes one. A tool that appeared cannot vanish
   mid-session — that would make the model's own earlier reasoning
   unreproducible.

## The measurement I already have, and the one I do not

Measured, free, from this tree (`createCodingTools`, serialized as
`{name, description, input_schema}`):

| tool | wire bytes |
|---|---|
| `edit_file` | 988 |
| `search_text` | 742 |
| `read_file` | 627 |
| `shell` | 539 |
| `write_file` | 534 |
| `list_dir` | 342 |
| **the entire built-in surface** | **3,772 B ≈ 943 tokens** |

**Our whole tool surface is under 1K tokens.** That is the denominator,
and it is the reason this ADR exists: it is small enough that one ordinary
MCP server can dominate it.

**What I have NOT measured: how big a real server actually is.** There is
no `~/.kiso/mcp-tools.json` on this machine, so I have no real server's
schemas to weigh. I am not going to put an estimate in an ADR and let it
harden into a fact — that is the exact failure this programme has paid for
more than once.

So **gate 1 is the measurement, and it costs $0**: spawn 2–3 real servers,
let the extension write its tool cache, and serialize it the same way the
table above was produced. No model call is involved — the schemas come
from the servers' own `list_tools`. **It runs in Docker**, per the owner's
standing constraint on running third-party servers.

**If that measurement comes back small — if real servers land near the
built-in surface rather than multiples of it — this ADR should be
withdrawn, not tuned.** Deferral buys nothing worth its hazard against a
2KB overhead.

## Decision, conditional on gate 1

**Above a declared byte budget, a server's tools are replaced by one
resident line; `load_tools` admits them on demand.**

- **The budget is declared, not tuned.** It is written down before the
  measurement, in the config, and the same in every session. A budget
  chosen after seeing which servers a user runs is a budget fitted to that
  user.
- **Below the budget, nothing changes.** A one- or two-server setup — the
  common case — behaves exactly as it does today, full schemas resident.
  This change must be invisible to the people it does not help.
- **`load_tools` is one call, and it is cheap.** It takes a server name
  and admits that server's schemas. It does not search, rank, or guess —
  the resident line already told the model what is there.
- **The cache stays.** `$KISO_HOME/mcp-tools.json` already registers
  cached tools pre-connect; deferral changes which of them go into the
  request, not how they are discovered.

## How it will be judged

**Functional, and it is the shipping condition:**

1. a built-in is **never** deferred, under any budget, including zero;
2. a deferred server's resident line is **present in every request**;
3. `load_tools` admits, and **nothing ever removes** an admitted schema;
4. below the budget, the request is **byte-identical** to today's.

(4) is the one that matters most and is the easiest to get wrong.

**Behavioural, reported and judged by nothing yet:** a small scenario set
where the right tool lives behind a deferred server, counting how often
the model reaches it. The honest statement: **a scenario set of this size
cannot establish that deferral is harmless.** It can only catch a
deferral that is grossly harmful. Saying otherwise would be claiming a
power the instrument does not have — and this programme has already
shipped one round whose sign rule was carried in from a round that had it.

## What this does not decide

- **Whether built-ins should ever be trimmed.** 943 tokens is not the
  problem; do not let this ADR become licence to touch them.
- **Any ranking or search over tools.** One resident line per server,
  chosen by the server's own identity. No relevance scoring — that is a
  second system with a second failure mode.
- **MCP approval policy.** `mcp__` tools stay in the ask tier. Deferral is
  about bytes, not trust.

## When to overturn it

- **Gate 1 comes back small** — withdraw, as above.
- **A user cannot reach a capability they know they installed.** That is
  the hazard landing, and it outranks any byte saving.
- **The resident line turns out to be enough on its own** — if models
  reliably call `load_tools` from the line alone, the budget can go to
  zero and every server defers; if they do not, the budget is the whole
  mechanism and should be raised, not lowered.
