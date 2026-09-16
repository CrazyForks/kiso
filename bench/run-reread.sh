#!/bin/sh
# run-reread.sh <pairs>
#
# The re-read exemption round: the published system prompt against the same
# build with one bullet changed. Kit: kits/reread-exemption.md, frozen
# before this script ran a leg.
#
# THE TWO ARMS ARE TWO BUILDS, selected by KISO_BIN_CTL / KISO_BIN_ARM —
# which is a BUILD PATH, and a build path is exactly the kind of label that
# can be wrong while every number still looks fine. So no leg is scored on
# the strength of what this script was asked to launch: run-t6.sh writes a
# `prompt_arm` sidecar read from the leg's OWN first captured request body,
# and the check below VOIDS any leg whose prompt is not the one intended.
# A void leg is reported, never rescored.
#
# Order alternates within each pair so that neither arm always runs first:
# provider-side drift inside a pair would otherwise load onto one arm.
set -eu
PAIRS=${1:?usage: run-reread.sh <pairs>}
B="$(cd "$(dirname "$0")" && pwd)"
: "${KISO_BIN_CTL:?set KISO_BIN_CTL to the published-prompt build}"
: "${KISO_BIN_ARM:?set KISO_BIN_ARM to the changed-prompt build}"
ROUND=${KISO_ROUND:-reread}

want_arm()  { [ "$1" = arm ] && echo "exemption-extended" || echo "published"; }
bin_for()   { [ "$1" = arm ] && echo "$KISO_BIN_ARM" || echo "$KISO_BIN_CTL"; }
leg_id()    { [ "$1" = arm ] && echo "a$2" || echo "c$2"; }

VOID=0
run_leg() {
  ARM=$1; RUN=$2
  WORK="$B/runs/$ROUND/kiso-T6-$RUN"
  echo "--- $RUN ($ARM)"
  KISO_ROUND="$ROUND" BENCH_CAPTURE=1 KISO_BIN="$(bin_for "$ARM")" \
    sh "$B/run-t6.sh" kiso "$RUN" || echo "    (runner exited non-zero; its own status file is the record)"
  SAW=$(cat "$WORK/prompt_arm" 2>/dev/null || echo missing)
  WANT=$(want_arm "$ARM")
  if [ "$SAW" != "$WANT" ]; then
    # The leg's own evidence disagrees with what was launched. It is not an
    # $ARM leg, whatever the command line said.
    printf 'VOID: launched as %s, its bodies carry %s\n' "$ARM" "$SAW" > "$WORK/void"
    echo "    VOID — wanted $WANT, the leg's bodies carry $SAW"
    VOID=$((VOID + 1))
  fi
}

I=1
while [ "$I" -le "$PAIRS" ]; do
  if [ $((I % 2)) -eq 1 ]; then FIRST=ctl; SECOND=arm; else FIRST=arm; SECOND=ctl; fi
  run_leg "$FIRST"  "$(leg_id "$FIRST"  "$I")"
  run_leg "$SECOND" "$(leg_id "$SECOND" "$I")"
  I=$((I + 1))
done

echo
echo "pairs requested: $PAIRS   void legs: $VOID"
[ "$VOID" -eq 0 ] || echo "A VOID LEG IS NOT A DATA POINT. The verdict script refuses the round rather than scoring around one."
