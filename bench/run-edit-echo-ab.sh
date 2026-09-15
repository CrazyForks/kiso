#!/bin/sh
# The edit-echo A/B — three interleaved pairs on T6.
#
# Criteria are FROZEN in kits/edit-echo-ab.md and were committed before any
# leg ran. This script runs the legs and checks the VALIDITY gates; it does
# not compute the verdict, because a driver that also judges is a driver
# that can be adjusted until it agrees.
#
# Interleaved A1 B1 A2 B2 A3 B3, serial: provider drift over the afternoon
# falls on both arms of each pair, which is the whole reason BM-1 pairs.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
: "${DEEPSEEK_API_KEY:?set DEEPSEEK_API_KEY before running}"
export KISO_ROUND=${KISO_ROUND:-edit-echo-ab}
export KISO_BIN="${KISO_BIN:-node /Users/vinve/Desktop/devv/kiso/apps/cli/dist/index.js}"
# The build under test is LOCAL and carries an experimental switch the
# published 0.36.0 does not. Labelling both arms plain "0.36.0" would put a
# version on the record that no published artifact matches.
export KISO_VERSION=${KISO_VERSION:-0.36.0-ab.local}
export BENCH_EFFORT=${BENCH_EFFORT:-high}

say() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$1"; }

# Validity, read from the leg's OWN evidence. Never from what it was asked.
check_leg() { # $1=run-id  $2=expected echo (off|on)
	W="$B/runs/$KISO_ROUND/kiso-T6-$1"
	_st=$(cat "$W/status" 2>/dev/null || echo "missing")
	_ef=$(cat "$W/effort_bound" 2>/dev/null || echo "missing")
	_ec=$(cat "$W/edit_echo" 2>/dev/null || echo "missing")
	_vf=$(cat "$W/verify" 2>/dev/null || echo "missing")
	_ok=yes
	case "$_st" in complete) : ;; *) _ok=no ;; esac
	[ "$_ef" = "$BENCH_EFFORT" ] || _ok=no
	[ "$_ec" = "$2" ] || _ok=no
	say "  $1: status=$_st effort=$_ef edit_echo=$_ec (want $2) verify=$_vf -> $( [ $_ok = yes ] && echo VALID || echo VOID )"
	[ "$_ok" = yes ]
}

VOID=0
for P in 1 2 3; do
	say "pair $P — control leg a$P"
	BENCH_EDIT_ECHO=0 sh "$B/run-t6.sh" kiso "a$P" || say "  a$P: the runner exited nonzero"
	check_leg "a$P" off || VOID=$((VOID + 1))

	say "pair $P — echo leg b$P"
	BENCH_EDIT_ECHO=1 sh "$B/run-t6.sh" kiso "b$P" || say "  b$P: the runner exited nonzero"
	check_leg "b$P" on || VOID=$((VOID + 1))
done

say "done — $VOID leg(s) failed a validity gate"
[ "$VOID" -eq 0 ] || say "A VOID LEG IS NOT A DATA POINT. Fix the instrument and re-run rather than scoring around it."
