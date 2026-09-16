#!/bin/sh
# Round A — the default tool table. NINE interleaved pairs, ABBA.
#
# Criteria frozen in kits/tool-table-a.md before any leg. n = 9 comes from
# the measured variance (reasoning per request across three replicate legs:
# 94.7 / 167.3 / 109.1, CV 31%, so a paired delta carries ~±44%; separating
# 1.3x from 1.0x needs nine pairs). The two previous rounds were sized at
# three and neither could resolve what it was built to measure.
#
# THE ARMS DIFFER IN ONE THING, through the product's own code path:
#   control  the default table as it ships — 7 tools
#   A        KISO_SUBAGENT_DEPTH=1, the subagent extension's own depth
#            guard, which returns no tools — 6 tools
# Same binary, same prompt, same model, same endpoint, same effort, same
# turns. No shadowing extension, no config file, no build that the product
# does not ship.
#
# A APPROXIMATES A DEFERRED DESIGN, NOT A REMOVAL. The owner has ruled that
# `delegate` and `ask_user` are default capabilities that must never require
# manual configuration; the mechanism this round informs is automatic
# deferred loading, and A's arm is that design's steady state with nothing
# loaded. The decision after this round is "defer" against "keep present",
# never "config".
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
: "${DEEPSEEK_API_KEY:?set DEEPSEEK_API_KEY before running}"
export KISO_ROUND=${KISO_ROUND:-tool-table-a}
export KISO_BIN="${KISO_BIN:-/private/tmp/kiso-install/node_modules/.bin/kiso}"
export KISO_VERSION=${KISO_VERSION:-0.36.0}
export BENCH_EFFORT=${BENCH_EFFORT:-high}
export BENCH_CAPTURE=1
PAIRS=${PAIRS:-9}

say() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$1"; }

check_leg() { # $1=run  $2=expect delegate present? yes|no
	W="$B/runs/$KISO_ROUND/kiso-T6-$1"
	_st=$(cat "$W/status" 2>/dev/null || echo missing)
	_vf=$(cat "$W/verify" 2>/dev/null || echo missing)
	_ew=$(cat "$W/effort_wire" 2>/dev/null || echo missing)
	_tt=$(cat "$W/tool_table" 2>/dev/null || echo missing)
	case "$_tt" in *delegate*) _has=yes ;; *) _has=no ;; esac
	_ok=yes
	[ "$_st" = complete ] || _ok=no
	[ "$_ew" = "$BENCH_EFFORT" ] || _ok=no
	# THE ARM IS READ FROM THE LEG'S OWN TABLE. A leg labelled A whose table
	# still carries `delegate` is not an A leg, and the mislabel would make
	# both arms agree because they were the same arm.
	[ "$_has" = "$2" ] || _ok=no
	say "  $1: status=$_st verify=$_vf wire-effort=$_ew delegate-in-table=$_has (want $2) -> $( [ $_ok = yes ] && echo VALID || echo VOID )"
	[ "$_ok" = yes ]
}

VOID=0
for P in $(seq 1 "$PAIRS"); do
	if [ $((P % 2)) -eq 1 ]; then ORDER="ctl a"; else ORDER="a ctl"; fi
	for ARM in $ORDER; do
		say "pair $P — $ARM"
		if [ "$ARM" = a ]; then
			BENCH_NO_DELEGATE=1 sh "$B/run-t6.sh" kiso "a$P" || say "  the runner exited nonzero"
			check_leg "a$P" no || VOID=$((VOID + 1))
		else
			BENCH_NO_DELEGATE=0 sh "$B/run-t6.sh" kiso "ctl$P" || say "  the runner exited nonzero"
			check_leg "ctl$P" yes || VOID=$((VOID + 1))
		fi
	done
done

say "done — $VOID leg(s) failed a validity gate"
[ "$VOID" -eq 0 ] || say "A VOID LEG IS NOT A DATA POINT."
