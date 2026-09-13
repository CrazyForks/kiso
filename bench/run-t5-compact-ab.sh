#!/bin/sh
# kiso A/B: does a manual /compact at this point pay for itself?
#
# The calibration leg showed request 22 re-sending 5,685 fresh tokens right
# after the `/compact` segment boundary, and I read that as "compaction broke
# the cache, eliminating it saves ~10%". Astra's audit says that is not
# established: the compact reported `saved ~0`, context went 2% -> 2%, the
# replaced history segment GREW from ~354 to ~871 tokens, the head hash did
# not change, and the summary call itself cost ~5,092 cost_eq — 12.7% of the
# leg. So the question worth testing is not "how much does the break cost"
# but WHETHER COMPACTING AT 2% CONTEXT IS NET NEGATIVE AT ALL.
#
# The design: ONE shared checkpoint (turns 1-5), then two continuations that
# differ in exactly one input. Same fixture snapshot, same bare environment,
# same process restarts, same subsequent turns. Anything else and the pair
# measures something other than the compact.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
. "$B/leg-limits.sh"
. "$B/bare-env.sh"
RUN=${1:-ab1}
ROUND=${KISO_ROUND:-compact-ab}
DEADLINE=${KISO_LEG_DEADLINE_S:-900}
. "${XDG_CONFIG_HOME:-$HOME/.config}/claude-deepseek/credentials.env"
TURN() { node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-t5.json','utf8'))[$1-1])"; }

# ── the shared checkpoint: turns 1-5, run ONCE ──────────────────────────
CKPT="$B/runs/$ROUND/checkpoint-$RUN"
rm -rf "$CKPT"; mkdir -p "$CKPT"
cp -R "$B/fixture-t5/" "$CKPT/repo/"; rm -rf "$CKPT/repo/.git"
CK_HOME="$CKPT/kiso-home"; EXT="$CKPT/ext"; SK="$CKPT/skills"
mkdir -p "$EXT" "$SK"; cp "$B/bench-allow.mjs" "$EXT/"
BARE=$(bare_home "$CKPT")
set -- "OPENAI_BASE_URL=https://api.deepseek.com" "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
  "OPENAI_MODEL=deepseek-v4-flash" "KISO_EXTENSIONS_DIR=$EXT" "KISO_HOME=$CK_HOME" \
  "KISO_SKILLS_DIR=$SK" "KISO_NO_UPDATE_CHECK=1"
PAIRS="$*"
( cd "$CKPT/repo" && printf '%s\n' "$(TURN 1)" "$(TURN 2)" "$(TURN 3)" "$(TURN 4)" "$(TURN 5)" |
  bare_bounded "$BARE" "$DEADLINE" "$CKPT/stdout-1.log" $PAIRS -- kiso --mode bypass "ab-$RUN" ) || true
echo "checkpoint: $(node "$B/requests-so-far.mjs" "$CKPT" kiso) requests after turns 1-5"

# ── the two continuations, from a COPY of that one checkpoint ───────────
for arm in compact nocompact; do
  W="$B/runs/$ROUND/$arm-$RUN"
  rm -rf "$W"; mkdir -p "$W"
  cp -R "$CKPT/repo" "$W/repo"
  cp -R "$CK_HOME" "$W/kiso-home"
  cp -R "$EXT" "$W/ext"; mkdir -p "$W/skills"
  WBARE=$(bare_home "$W")
  set -- "OPENAI_BASE_URL=https://api.deepseek.com" "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
    "OPENAI_MODEL=deepseek-v4-flash" "KISO_EXTENSIONS_DIR=$W/ext" "KISO_HOME=$W/kiso-home" \
    "KISO_SKILLS_DIR=$W/skills" "KISO_NO_UPDATE_CHECK=1"
  WP="$*"
  S=$(date +%s)
  # the ONE difference: the compact arm sends /compact in its own process,
  # exactly as run-t5.sh does; the other arm restarts the process too, so the
  # restart itself is not the variable.
  if [ "$arm" = compact ]; then
    ( cd "$W/repo" && printf '/compact\n' |
      bare_bounded "$WBARE" "$DEADLINE" "$W/stdout-2.log" $WP -- kiso --mode bypass "ab-$RUN" ) || true
  else
    ( cd "$W/repo" && printf '\n' |
      bare_bounded "$WBARE" "$DEADLINE" "$W/stdout-2.log" $WP -- kiso --mode bypass "ab-$RUN" ) || true
  fi
  ( cd "$W/repo" && printf '%s\n' "$(TURN 6)" "$(TURN 7)" "$(TURN 8)" |
    bare_bounded "$WBARE" "$DEADLINE" "$W/stdout-3.log" $WP -- kiso --mode bypass "ab-$RUN" ) || true
  E=$(date +%s)
  echo "$((E-S))" > "$W/wall_seconds"
  "$B/t5-verify.sh" "$W/repo" > "$W/verify"
  mark_complete "$W"
  echo "$arm: wall=$((E-S))s verify=$(cat "$W/verify") requests=$(node "$B/requests-so-far.mjs" "$W" kiso)"
done
