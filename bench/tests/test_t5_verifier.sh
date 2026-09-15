#!/bin/sh
# Does the T5 verifier actually discriminate? Astra's requirement: prove it
# with a correct AND an incorrect sample. Four samples, because the
# interesting failures are not "wrong code".
set -eu
B="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$B/fixture-t5"
PASSES=0; FAILS=0
check() { # name expected
  got=$("$B/t5-verify.sh" "$2")
  if [ "$got" = "$3" ]; then printf "  ok   %-52s -> %s\n" "$1" "$got"; PASSES=$((PASSES+1));
  else printf "  FAIL %-52s -> %s (wanted %s)\n" "$1" "$got" "$3"; FAILS=$((FAILS+1)); fi
}

# 1. A WORKSPACE THAT REALLY PASSED, from the archive.
#
#    Not the fixture: fixture-t5 is the task's STARTING state, deliberately
#    incomplete — the eight turns are what an arm must implement. Using it as
#    the "correct" sample asserted that the starting point is the answer, and
#    this test caught that on its first run.
#
#    A real passing workspace is also stronger evidence: it proves the
#    verifier accepts work an arm actually produced, not work we wrote to
#    satisfy our own verifier.
PASSED_LEG=${T5_PASSED_LEG:-}
if [ -z "$PASSED_LEG" ]; then
  for cand in /Users/vinve/Desktop/devv/kiso/bench/runs/*T5*/; do
    [ -f "$cand/verify" ] || continue
    [ "$(cat "$cand/verify")" = "pass" ] || continue
    [ -d "$cand/repo/src" ] || continue
    PASSED_LEG="$cand/repo"; break
  done
fi
if [ -n "$PASSED_LEG" ] && [ -d "$PASSED_LEG" ]; then
  A=$(mktemp -d); cp -R "$PASSED_LEG/." "$A/"
  check "a workspace that really passed (from the archive)" "$A" pass
else
  echo "  SKIP no archived passing leg found — set T5_PASSED_LEG"
fi

# 2. a genuinely wrong implementation
Bd=$(mktemp -d); cp -R "$FIXTURE/." "$Bd/"
perl -0pi -e 's/export function clamp\([^)]*\) \{/export function clamp(v, lo, hi) { return v;/' "$Bd/src/range.js" 2>/dev/null || true
printf '\nexport function clamp(v){return v;}\n' >> "$Bd/src/range.js"
check "a broken clamp" "$Bd" fail

# 3. THE ONE THAT MATTERS: the source is untouched and WRONG, but the
#    workspace's tests were rewritten to pass. The old verifier said pass.
C=$(mktemp -d); cp -R "$FIXTURE/." "$C/"
printf '\nexport function clamp(v){return v;}\n' >> "$C/src/range.js"
for t in "$C"/tests/*.test.js; do printf 'console.log("ok");\n' > "$t"; done
check "broken source + tests rewritten to pass" "$C" fail

# 4. src deleted entirely — a workspace that cannot be verified is not a pass
D=$(mktemp -d); cp -R "$FIXTURE/." "$D/"; rm -rf "$D/src"
check "no src at all" "$D" fail

echo
echo "[t5-verify] $PASSES ok, $FAILS failed"
[ "$FAILS" -eq 0 ]
