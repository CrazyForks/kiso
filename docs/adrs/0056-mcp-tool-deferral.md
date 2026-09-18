# ADR-0056: MCP servers get one resident line, not every schema, above a declared budget

- **Status:** **Accepted** — reviewed by the lead, then ratified by the
  owner on 2026-09-17 in their own words. Nothing is built yet; the
  decision is recorded and the code follows its own round.
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
3. **Admission is append-only** (design A). `load_tools` adds schemas to
   the live request and never removes one.

   It is not free, and the two costs are worth naming. **One round trip**
   — the model asks, gets the schemas, then acts. And **one cache break**:
   the tool table sits near the front of the request, so growing it
   invalidates the prompt cache for everything behind it.

   That second cost is the real argument for append-only, not tidiness. A
   table that only ever grows breaks the cache **once per load**, and
   every request after that load is cacheable again against the new
   prefix. A table that can shrink as well as grow breaks it repeatedly
   and unpredictably, and nothing in the session ever settles. Append-only
   also keeps the model's earlier reasoning reproducible: a tool that
   appeared cannot vanish mid-session.

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

### GATE 1 IS RUN — and it does not withdraw the ADR

Measured 2026-09-17 in a container, $0, no model call: four official
reference servers, their schemas read from their own `tools/list` over
stdio and serialised exactly as the built-in table above.

| server | tools | bytes | against the built-in surface |
|---|---|---|---|
| filesystem | 14 | 7,986 | **2.12×** |
| memory | 9 | 4,159 | 1.10× |
| sequentialthinking | **1** | 4,035 | **1.07×** |
| everything | 13 | 4,940 | 1.31× |
| **all four** | 37 | **21,120 B ≈ 5,280 tok** | **5.60×** |

Against the budget declared ABOVE, before these numbers existed: a single
server defers past 2× (7,544 B), all servers past 4× (15,088 B).
**Filesystem alone clears the single-server threshold at 2.12×, and four
ordinary servers clear the collective one at 5.60×.** The problem is
real and the budget was not fitted to it.

**The finding that outranks the totals: `sequentialthinking` has ONE tool
and costs 4,035 bytes — more than every built-in tool kiso ships,
combined.** A budget reasoned per SERVER, or per tool count, would have
missed it. That is a direct argument for the proxy: its resident cost is
constant at ~200 tokens whatever the tool count, while any
schemas-resident design pays whatever a single verbose tool decides to
cost.

**What I have NOT measured: how big a real server actually is.** There is
no `~/.kiso/mcp-tools.json` on this machine, so I have no real server's
schemas to weigh. I am not going to put an estimate in an ADR and let it
harden into a fact — that is the exact failure this programme has paid for
more than once.

(The paragraphs below were written BEFORE the gate ran and are kept as
they stood, so the prediction and the result can be read against each
other.)

So **gate 1 is the measurement, and it costs $0**: spawn 2–3 real servers,
let the extension write its tool cache, and serialize it the same way the
table above was produced. No model call is involved — the schemas come
from the servers' own `list_tools`. **It runs in Docker**, per the owner's
standing constraint on running third-party servers.

**Under the recommended design its ROLE changes, and that is a point in
the design's favour.** With a proxy the resident cost is constant and no
threshold exists, so gate 1 stops being the shipping gate. But it is still
worth its zero dollars, for one question it alone answers: **is there a
problem at all?** If real servers land near the built-in surface rather
than multiples of it, then neither design buys anything worth its hazard,
and **this ADR should be withdrawn, not tuned.** A design chosen against a
problem that turns out not to exist is the most expensive kind.

## Two designs, and a recommendation

Since the first draft, the reference implementation's most-installed MCP
adapter was read (939.7K downloads a month — a design proven at a scale
none of ours are). **It does not do what this ADR first proposed.** Rather
than admit schemas on demand, it puts **one proxy tool** in front of every
server. That is a different answer to the same problem and it deserves to
be written down beside ours rather than discovered later.

### Design A — deferred schemas (this ADR's first draft)

Above a byte budget, a server's schemas are withheld; one resident line
names it; `load_tools` admits the real schemas, append-only.

### Design B — one proxy tool

**One tool, about 200 tokens, for all servers.** It takes an operation
rather than a server: `search` over locally cached tool metadata (no live
connection), `describe` for one tool's detail, and `call` with a tool name
and arguments. Servers connect **lazily**, on first call. A setting
promotes chosen tools to real first-class schemas when a tool is used
often enough to be worth its bytes.

The reference implementation also offers a middle setting — register a
server's schemas but leave them **inactive** until a search activates them
— which is close to design A. It is an option there; the proxy is the
default. That is itself worth reading: the design nearest to our draft
exists in that product and is not what it ships by default.

### The trade-offs, stated so neither is chosen by taste

| | A: deferred schemas | B: proxy |
|---|---|---|
| resident cost | one line per server, grows with server count | **constant**, ~200 tokens, 50 servers or 2 |
| cache, within a session | **one break per `load_tools`** — the tool table grows | **zero breaks** — the table never changes |
| cache, ACROSS sessions | a distinct prefix per load history | **one prefix forever**, warm on first request |
| a budget | needed, and must be declared and defended | **none — the question disappears** |
| schema binding on a call | **native**: the API validates arguments | **none**: arguments go as a blob, and the adapter's error path is what teaches the model |
| server startup | on connect | **lazy**, on first call |
| round trips | one `load_tools`, then direct calls | one discovery call per lookup, every time |

### The cache reaches further than either design assumed

Measured while pricing ADR-0055, from 937 interactive requests and 14,821
autonomous ones: **the FIRST request of a session already hits the cache —
0.68 interactive, 0.93 autonomous.** The system-prompt-plus-tool-table
prefix survives *between* sessions, not merely within one.

That changes what the tool table costs. A table that is byte-identical in
every session is a prefix every future session can start warm against. A
table that depends on which servers happened to be loaded last time is a
**different prefix per load history**, and each one is cached separately
or not at all.

So design B's constant table is worth more than its ~200 tokens suggest,
and design A's cache break is worse than "once per `load_tools`": it also
forfeits the cross-session warm start for every table shape it creates.

**The honest boundary on this evidence:** it was measured on a product
whose table IS constant today — six built-ins, no MCP servers configured
on the machine. It demonstrates that a constant prefix caches across
sessions. It does **not** measure what a varying table costs, because
nothing here varied. That measurement would need a fixture with servers,
and it is a reason to prefer B rather than a number attached to A.

### Constant rent beats any per-server or per-count budget

Gate 1 settled this by accident. **`sequentialthinking` has ONE tool and
costs 4,035 bytes — more than every built-in tool kiso ships, combined.**

A budget reasoned per SERVER would have let it through as "just one
server". A budget reasoned per TOOL COUNT would have let it through as
"just one tool". Only a budget in BYTES catches it, and even a byte
budget has to be re-checked every time a server updates, because a
server's cost is whatever its authors decided a description should say.

The proxy does not have this problem to have: **its resident cost is
~200 tokens whatever is behind it** — one tool or four hundred, terse
schemas or essays. That is the argument for B stated in its strongest
form, and it is an argument no threshold can answer.

**The recommendation is B, with promotion as a later increment.**

Two reasons, and the second is the stronger one:

1. Constant rent and zero cache breaks beat a budget that has to be
   declared, defended, and eventually tuned. Under B, **gate 1 stops being
   the shipping gate** — there is no threshold for a server to exceed.
2. It moves the whole question from *bytes* to *behaviour*: does the model
   search, describe, and call correctly through one indirection? That is
   the same question as the skills check, in the same shape, and we
   already know how to ask it.

**What B costs and A does not:** the model loses native argument
validation. Under A the API rejects a malformed call against a real
schema; under B a bad argument blob reaches the adapter, which must
explain itself well enough that the model's next attempt is right. That
error path is not a detail — it is the entire correctness story, and it is
the first thing to measure.

**Built-ins never proxy**, under either design. The six tools are how the
product works; they stay real schemas with real validation.

### If A were chosen instead

The budget is declared here rather than left to be tuned later: a single
server defers above **2× the built-in surface** (> 7,544 B ≈ 1,886
tokens), and all servers together above **4×** (> 15,088 B ≈ 3,772
tokens), changed only by a recorded ruling. A budget chosen after seeing
gate 1's numbers, or after seeing which servers a particular user runs,
would be fitted to its evidence and would make the gate decorative.

## How it will be judged

**Functional, and it is the shipping condition.** Under the recommended
proxy design:

1. a built-in is **never** proxied — the six ship as real schemas with
   real validation, always;
2. the proxy's resident cost does **not grow** with the number of servers
   — one server and twenty produce the same tool table;
3. the tool table is **byte-identical across a session** where no
   promotion happens, so the cache never breaks;
4. a server connects **only on first call**, never at startup;
5. a malformed argument blob comes back as an error the model can act on
   — **asserted on the message, not on the failure**;
6. with no MCP servers configured, the request is **byte-identical to
   today's**.

(6) protects everyone this change is not for, and is the easiest to skip.
(5) is the one that decides whether the design works at all: under a proxy
the adapter's error path replaces the API's schema validation, so a vague
error is not a rough edge, it is the defect.

Under design A instead, the list is: built-ins never defer; the resident
line is present in every request; `load_tools` admits and nothing ever
removes; and below the budget the request is byte-identical to today's.

**The prior question is not in this ADR at all.** The skills extension
already ships this architecture — one resident line per skill, full text
on demand — and nobody has checked whether the line reaches the body. The
skills behaviour check asks exactly that, and the precedence is explicit:
**if the model does not reach tier 2 from an index line, this ADR waits
for that to be fixed rather than inheriting it.** Shipping a second
instance of an architecture whose first instance does not work would be
choosing not to know.

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
- **Which design ships.** This ADR recommends the proxy and writes both
  down with what each needs measured. The choice is the owner's, and it
  should be taken with the skills check's result in hand, not before.
- **Promotion policy under the proxy.** Promoting a hot tool to a real
  schema is a later increment; how a tool earns promotion — configured by
  hand, or by observed use — is not decided here. Hand-configured first,
  because the observed-use version is a second system.
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
