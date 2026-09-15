#!/bin/sh
# T5 verify — the three final checks after the 8 progressive turns.
#
# THE TESTS COME FROM THE FIXTURE, NEVER FROM THE WORKSPACE.
#
# The whole fixture, `tests/` included, is copied into the workspace the
# agent edits with write and shell access. Running the workspace's own tests
# asked the agent to mark its own paper: rewriting `tests/range.test.js` to
# exit 0 passed the verifier without touching a line of `src/`. That is the
# difference between DONE and CLAIMS DONE, and a bar an arm can move is not
# a bar.
#
# So the reference tests are copied out of the fixture at verify time and run
# against the workspace's `src/`. The agent's edits to `tests/` are ignored —
# they are not wrong to make, they are simply not evidence.
set -eu
WORK="$1"
FIXTURE="$(cd "$(dirname "$0")" && pwd)/fixture-t5"
[ -d "$FIXTURE/tests" ] || { echo "fail"; exit 0; }

ARENA=$(mktemp -d /tmp/t5-verify.XXXXXX)
trap 'rm -rf "$ARENA"' EXIT
# the workspace's source, the fixture's tests
cp -R "$WORK/src" "$ARENA/src" 2>/dev/null || { echo "fail"; exit 0; }
cp -R "$FIXTURE/tests" "$ARENA/tests"
[ -f "$WORK/package.json" ] && cp "$WORK/package.json" "$ARENA/" 2>/dev/null || true

cd "$ARENA"
node tests/range.test.js > /dev/null 2>&1 \
  && node tests/report.test.js > /dev/null 2>&1 \
  && [ "$(node src/cli.js --count '1-2,3-4' 2>/dev/null | tail -1)" = "2" ] \
  && echo pass || echo fail
