#!/bin/sh
# CTX-1 diagnostic: where should the compaction threshold sit?
#
# The product derives it from the model window at 2:1. That ratio has never
# been measured — it was chosen, and the fallback for an unregistered window
# (200,000) then set it at 100,000 for every DeepSeek model. The question is
# whether compacting at that point pays for itself.
#
# THE ONE DIFFERENCE between the arms is KISO_POLICY_MICROCOMPACT. The
# window env is deliberately NOT used: it also arms auto-summary, which would
# be a second variable in a two-arm comparison. The armed policy beats both
# threshold doors added by CTX-1, which is asserted in
# packages/runtime/tests/ctx1-threshold-travels-with-the-binding.test.ts,
# not assumed here.
#
# SCALE. The longest existing bench task peaks at 9,302 tokens of context on
# the kiso arm and 37,887 on the most context-hungry arm of the same task.
# The product's real threshold is 100,000, so NO bench leg has ever crossed a
# compaction threshold and this fixture cannot test the product's real
# values. It tests the RATIO regime: EARLY and LATE straddle the task's own
# peak with the same 5:1 spread as 100k:500k. A result here transfers as a
# DIRECTION, never as a default value — cache pricing has absolute token
# thresholds that a scaled run does not reach.
#
# THE TRIGGER READS A DIFFERENT NUMBER THAN THE EXTRACTOR DOES. It fires on
# estimateTokens(projected messages) — a chars/4 estimate of what WOULD be
# sent — while 9,302 is what the provider BILLED. The two are not the same
# quantity, so EARLY and LATE cannot be derived from billed figures. Pair 1
# is therefore a RESOLUTION CHECK: if the early arm writes no boundary, or
# the late arm writes one, the arms are not actually different and the run
# stops before spending on pairs 2 and 3. An instrument with no resolution
# reports cleanly and means nothing.
#
# What this fixture CANNOT test: T5's later turns read their inputs off disk,
# so clearing an old read costs a re-read and nothing more. The expensive
# half of the question — whether clearing destroys information the agent
# cannot recover — needs a task whose early information exists only in
# context. That is a new fixture, not a new threshold.
#
# Interleaved, three pairs, alternating which arm goes first, so provider
# drift lands on both arms equally rather than on whichever ran second.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
. "$B/leg-limits.sh"
. "$B/bare-env.sh"
ROUND=${KISO_ROUND:-threshold-ab}
DEADLINE=${KISO_LEG_DEADLINE_S:-900}
EARLY=${KISO_AB_EARLY:-4000}    # crosses well before the task's peak
LATE=${KISO_AB_LATE:-20000}     # never fires on this fixture
PAIRS_N=${KISO_AB_PAIRS:-3}
FROM=${KISO_AB_FROM:-1}         # resume without re-spending on earlier pairs
. "${XDG_CONFIG_HOME:-$HOME/.config}/claude-deepseek/credentials.env"
TURN() { node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-t5.json','utf8'))[$1-1])"; }

# The leg directory name is what bench/extract-t5.py parses: it globs
# runs/*T5* and splits <tool>-<task>-<run>, with tool in {kiso, pi, claude}.
# Naming the legs for the extractor means reusing an instrument that has
# already been audited, instead of writing a second one with fresh bugs.
# The extra runs/ layer is the extractor's, not decoration: it globs
# <workdir>/runs/*T5*, so the round directory is the workdir and the legs
# live one level inside it.
legdir() { printf '%s/runs/%s/runs/kiso-T5%s-p%s\n' "$B" "$ROUND" "$1" "$2"; }
boundaries_of() { cat "$(legdir "$1" "$2")/kiso-home/sessions/"*.jsonl 2>/dev/null |
  grep -c '"type":"microcompacted"' || true; }

leg() {
  arm=$1; thr=$2; pair=$3
  W=$(legdir "$arm" "$pair")
  rm -rf "$W"; mkdir -p "$W"
  cp -R "$B/fixture-t5/" "$W/repo/"; rm -rf "$W/repo/.git"
  mkdir -p "$W/ext" "$W/skills"; cp "$B/bench-allow.mjs" "$W/ext/"
  WBARE=$(bare_home "$W")
  printf '%s\n' "$thr" > "$W/threshold"
  S=$(date +%s)
  # The pairs go in as SEPARATE ARGUMENTS. bare_bounded splits its own list
  # at `--` and never re-parses a string, which is the whole point of the
  # helper: $PATH here contains a directory with a space in it.
  ( cd "$W/repo" && printf '%s\n' "$(TURN 1)" "$(TURN 2)" "$(TURN 3)" "$(TURN 4)" \
      "$(TURN 5)" "$(TURN 6)" "$(TURN 7)" "$(TURN 8)" |
    bare_bounded "$WBARE" "$DEADLINE" "$W/stdout.log" \
      "OPENAI_BASE_URL=https://api.deepseek.com" \
      "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
      "OPENAI_MODEL=deepseek-v4-flash" \
      "KISO_EXTENSIONS_DIR=$W/ext" \
      "KISO_HOME=$W/kiso-home" \
      "KISO_SKILLS_DIR=$W/skills" \
      "KISO_NO_UPDATE_CHECK=1" \
      "KISO_POLICY_MICROCOMPACT=$thr" \
      -- kiso --mode bypass "thr-$arm-$pair" ) || true
  E=$(date +%s)
  echo "$((E-S))" > "$W/wall_seconds"
  "$B/t5-verify.sh" "$W/repo" > "$W/verify"
  mark_complete "$W"
  f=$(boundaries_of "$arm" "$pair"); [ -n "$f" ] || f=0
  echo "$arm pair=$pair thr=$thr wall=$((E-S))s verify=$(cat "$W/verify") requests=$(node "$B/requests-so-far.mjs" "$W" kiso) boundaries=$f"
}

p=$FROM
while [ "$p" -le "$PAIRS_N" ]; do
  if [ $((p % 2)) -eq 1 ]; then
    leg early "$EARLY" "$p"; leg late "$LATE" "$p"
  else
    leg late "$LATE" "$p"; leg early "$EARLY" "$p"
  fi
  if [ "$p" -eq 1 ]; then
    e=$(boundaries_of early 1); l=$(boundaries_of late 1)
    [ -n "$e" ] || e=0; [ -n "$l" ] || l=0
    echo "resolution check: early=$e boundaries, late=$l boundaries"
    if [ "$e" -lt 1 ] || [ "$l" -ne 0 ]; then
      echo "STOP — the two arms did not separate. Nothing further runs."
      echo "  early must write at least one boundary; late must write none."
      echo "  Adjust KISO_AB_EARLY / KISO_AB_LATE and re-run pair 1 alone."
      exit 3
    fi
  fi
  p=$((p + 1))
done
echo "--- extract with: python3 $B/extract-t5.py $B/runs/$ROUND ---"
