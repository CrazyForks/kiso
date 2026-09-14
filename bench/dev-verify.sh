#!/bin/sh
# Acceptance for the real-development tasks. Prints exactly: pass | fail
#
# The acceptance tests live OUTSIDE the fixture and are copied in here, at
# verify time, from a pristine source. The agent works in the fixture; it
# never sees these, and it cannot edit them — a verifier whose expectations
# the subject can move is not one. The same reason t5-verify.sh copies its
# tests rather than running the workspace's.
#
# The fixture's OWN tests run too. A task that says "do not break what is
# there" is not accepted by the new behaviour alone.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
W=$1          # the workspace the agent worked in
TASK=$2       # devA | devB | devC
ACC="$B/accept-$TASK"
[ -d "$ACC" ] || { echo "fail"; exit 0; }
TMP="$W/.accept-$$"
rm -rf "$TMP"; mkdir -p "$TMP"
cp "$ACC"/*.js "$TMP/" 2>/dev/null || { rm -rf "$TMP"; echo "fail"; exit 0; }
ok=1
for t in "$W"/tests/*.js; do
  [ -f "$t" ] || continue
  ( cd "$W" && node "$t" ) >/dev/null 2>&1 || ok=0
done
( cd "$W" && node "$TMP/accept.test.js" ) >/dev/null 2>&1 || ok=0
rm -rf "$TMP"
[ "$ok" -eq 1 ] && echo pass || echo fail
