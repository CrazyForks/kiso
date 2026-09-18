# The concealed set — the generator

The launch bench's concealed set is generated rather than written, so the
side that tunes the product never sees what it is scored on. The SHAPE (the
families, their parameter spaces, their verifiers) is committed and pinned
by hash here; the owner draws the SEED at the freeze and holds it;
instances are materialised inside the runner at run time and archived after
the scored legs.

**Nothing in this directory is an instance.** No materialised instance from
any seed except a throwaway test seed is ever committed, and a test enforces
it. The tuning side never runs the real seed.

## Commands

    node bench/concealed/cli.mjs shape-hash
    node bench/concealed/cli.mjs check-shape [--seeds N]
    node bench/concealed/cli.mjs list
    node bench/concealed/cli.mjs materialize --seed S --instance ID --out DIR
    node bench/concealed/cli.mjs verify --instance-dir DIR --workspace WS [--answer FILE] [--out DIR]
    node bench/concealed/cli.mjs self-check --seed S

- `materialize` writes `DIR/fixture/` (copied into the leg's workspace),
  `DIR/tasks.json` (the turn prompts, the array the T5/T6 runners read),
  `DIR/verifier/` (held out — never copied into a workspace) and
  `DIR/instance.json` (family, the favours label, parameters, the shape
  hash, the request estimate, and family F's kill spec).
- `verify` prints ONE word, `pass` or `fail`, and writes `verify.json` with
  every assertion: GATE or REPORTED, its result, and the statement it cites.
  Family E needs the leg's final assistant text: `--answer $WORK/answer.txt`
  (UTF-8, no BOM, trailing newline — the runner writes it for every leg).
- `self-check` materialises every instance of a seed and proves its
  verifier: the untouched fixture fails, the reference solution passes, and
  (B+D) a compensating change fails on B+D-3. It prints verdicts and ids
  only, so the ceremony can run it on the real seed.

## The families

The review's rulings (kiso-doc, 2026-09-16), each labelled with the arm
whose design it favours; results are reported per family.

| family | what it is | favours |
|---|---|---|
| A | progressive API construction, 6–10 turns | ours by history |
| B+D | a failure the task did not cause; `location` = named file / dependency / test | neither |
| C | a bounded change with a plausible decoy; scope reported, never gated | ours by tuning |
| E | the simple request, answered by doing; correctness gated, directness measured | theirs by design |
| F | an A instance interrupted at turn k; plus "no effect applied twice" | ours by design |

Six instances per family per arm: each family 20% (no family above one
third), E + F 40% (at least one third).

## The rules the shape is held to

- Every verifier is generated from the same spec as its task, and every
  assertion cites a verbatim clause of the turn that states it (checked at
  generation time and by a test).
- The parameter space of every family is far too large to enumerate.
- The files a task requires reading are long in the corpus's proportion
  (median 158 lines, p90 1,516, 42.6% of reads over the 200-line window):
  `check-shape` gates the share over 200 lines at [35%, 50%] and the median
  and p90 within ×1.5, over many throwaway seeds.
- `SHAPE_HASH` pins the shape; an edit without a re-pin is red.
