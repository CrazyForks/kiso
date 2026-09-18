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

## Two pins

- `SHAPE_HASH` — sha256 over `shape/*.mjs`: what is drawn.
- `APPARATUS_HASH` — sha256 over every other non-test `.mjs` here (verify,
  generate, materialize, self-check, check-shape, the CLI): how it is judged.

Both are printed by `check-shape`, carried in every `instance.json`, and
pinned by a test: an edit to either without a re-pin is red.

## Commands

    node bench/concealed/cli.mjs shape-hash
    node bench/concealed/cli.mjs apparatus-hash
    node bench/concealed/cli.mjs check-shape [--seeds N]
    node bench/concealed/cli.mjs check-shape --seed S
    node bench/concealed/cli.mjs list
    node bench/concealed/cli.mjs materialize --seed S --instance ID --out DIR
    node bench/concealed/cli.mjs verify --instance-dir DIR --workspace WS [--answer FILE] [--out DIR]
    node bench/concealed/cli.mjs self-check --seed S [--verbose yes]

Unknown flags are refused, per subcommand.

- `materialize` writes `DIR/fixture/` (copied into the leg's workspace),
  `DIR/tasks.json` (the turn prompts, the array the T5/T6 runners read),
  `DIR/verifier/` (held out — never copied into a workspace: the spec, the
  pristine fixture, the reference solution and the negative controls) and
  `DIR/instance.json` (family, the favours label, parameters, both hashes,
  the request estimate, and family F's kill spec).
- `verify` prints ONE word, `pass` or `fail`, on stdout and **exits 0 either
  way** — the runner reads the word, never the exit code (a non-zero exit
  means verify itself could not run). It writes `verify.json` with every
  assertion: GATE or REPORTED, its result, and what it cites. Family E needs
  the leg's final assistant text: `--answer $WORK/answer.txt` (UTF-8, no
  BOM, trailing newline — the runner writes it for every leg).
- `self-check` materialises every instance of a seed and proves its
  verifier: the untouched fixture fails, the reference solution passes, and
  each negative control fails on the gate it names (B+D: a compensation at
  the caller on B+D-3, a gutted test on B+D-1b, a bent function on B+D-2).
  Failures are described by gate TYPE and COUNT only; gate ids, which carry
  drawn names, appear only under `--verbose yes`, which the ceremony never
  passes.
- `check-shape --seed S` reports ONE drawn seed's counts and length figures
  — never content — and exits non-zero when the seed is outside the band.

## The seed ceremony (pre-registered, before the draw)

The length band is a property of the SHAPE and is gated in aggregate over
many seeds. About a third of single seeds fall outside it on their own, and
the owner draws ONE. So, fixed before the draw: at the freeze the max worker
runs `check-shape --seed <drawn>` with the owner present. In band → that
seed is used. Out of band → one redraw. Both draws, and both reports, are
written into the bench report. It is the rule, not the seed, that makes a
redraw legitimate.

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

**B+D is small, and says so.** 8 defectable functions, 14 (function, kind)
pairs, 42 (function, kind, location) triples, 234 distinct prompts (plus 120
test-location fixtures), counted from the pool by `check-shape`. Its
concealment rests on custody of the seed, not on the space being too large
to hold in mind. The per-family report carries the same count.

**The declared citation exception.** Every gate cites a verbatim clause of
the turn that states it — except B+D-2's export guard and B+D-3, which cite
the ruled B+D verifier doc (kiso-doc concealed-set-bd-verifier-2026-09-16):
the task's words say what should be RETURNED, not where the repair lands.
The citation test allows exactly those two ids to carry a doc citation.

## The rules the shape is held to

- Every verifier is generated from the same spec as its task, and every
  assertion cites what requires it (checked at generation time and by a
  test).
- A, C, E and F draw from parameter spaces far too large to enumerate; B+D
  does not, and states its true count (above).
- The files a task requires reading are long in the corpus's proportion
  (median 158 lines, p90 1,516, 42.6% of reads over the 200-line window):
  `check-shape` gates the share over 200 lines at [35%, 50%] and the median
  and p90 within ×1.5, over many throwaway seeds. For A and F a required
  file is "the file the turn names" — long on the path only if the arm
  reads it. E's `which-file` and `node-version` questions require no file.
  The length clamp is 4,000 lines, and some fixture files sit exactly on it.

## Tests

    node --test bench/concealed/tests/*.test.mjs

(The directory form, `node --test bench/concealed/tests/`, does not run on
Node 22.) `npm run check` runs the suite and `check-shape`.
