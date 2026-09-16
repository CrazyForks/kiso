#!/bin/sh
# run-ceremony.sh <pairs>
#
# The release ceremony: the rc against the PUBLISHED previous release,
# interleaved, on T5. BM-1's REGRESSION gate — the question is whether the
# rc got worse than what users already have, not whether it improved.
#
# The two arms are two BINARIES, selected by KISO_BIN_RC / KISO_BIN_CTL.
# That is a label, and a label can be wrong while every number still looks
# fine. run-t5.sh probes `$KISO_BIN --version` and records it in meta.json
# (it used to read the surrounding checkout instead — an arm labelled with
# a version it never executed, fixed after the 0.35.0 review). This script
# READS THAT BACK per leg and VOIDS any leg whose recorded version is not
# the one intended. A void leg is reported, never rescored.
#
# Order alternates within each pair: provider drift inside a pair would
# otherwise load onto one arm.
set -eu
PAIRS=${1:?usage: run-ceremony.sh <pairs>}
B="$(cd "$(dirname "$0")" && pwd)"
: "${KISO_BIN_RC:?set KISO_BIN_RC to the release candidate}"
: "${KISO_BIN_CTL:?set KISO_BIN_CTL to the published previous release}"
: "${RC_VERSION:?set RC_VERSION, e.g. 0.37.0}"
: "${CTL_VERSION:?set CTL_VERSION, e.g. 0.36.0}"
ROUND=${KISO_ROUND:-ceremony}

want_ver() { [ "$1" = rc ] && echo "$RC_VERSION" || echo "$CTL_VERSION"; }
bin_for()  { [ "$1" = rc ] && echo "$KISO_BIN_RC" || echo "$KISO_BIN_CTL"; }
leg_id()   { [ "$1" = rc ] && echo "rc$2" || echo "ctl$2"; }

VOID=0
run_leg() {
  ARM=$1; RUN=$2
  WORK="$B/runs/$ROUND/kiso-T5-$RUN"
  echo "--- $RUN ($ARM)"
  KISO_ROUND="$ROUND" KISO_BIN="$(bin_for "$ARM")" \
    sh "$B/run-t5.sh" kiso "$RUN" || echo "    (runner exited non-zero; its status file is the record)"
  SAW=$(node -e '
    const fs=require("fs");
    try { const m=JSON.parse(fs.readFileSync(process.argv[1]+"/meta.json","utf8"));
          console.log(String(m.kisoVersion ?? m.version ?? m.kiso?.version ?? "missing")); }
    catch { console.log("missing"); }' "$WORK" 2>/dev/null || echo missing)
  WANT=$(want_ver "$ARM")
  case "$SAW" in
    *"$WANT"*) : ;;
    *) printf 'VOID: launched as %s, its meta records %s (wanted %s)\n' "$ARM" "$SAW" "$WANT" > "$WORK/void"
       echo "    VOID — wanted $WANT, the leg records $SAW"; VOID=$((VOID + 1)) ;;
  esac
}

I=1
while [ "$I" -le "$PAIRS" ]; do
  if [ $((I % 2)) -eq 1 ]; then FIRST=ctl; SECOND=rc; else FIRST=rc; SECOND=ctl; fi
  run_leg "$FIRST"  "$(leg_id "$FIRST"  "$I")"
  run_leg "$SECOND" "$(leg_id "$SECOND" "$I")"
  I=$((I + 1))
done
echo
echo "pairs $PAIRS   void legs: $VOID"
[ "$VOID" -eq 0 ] || echo "A VOID LEG IS NOT A DATA POINT. Fix the wiring and re-run rather than scoring around one."
