#!/bin/sh
# T6 capture — three interleaved pairs, DIAGNOSTIC and UNSCORED.
#
# It exists to answer one question the scored rounds cannot: our requests
# carry more fresh input than the other arm's (312 / 393 / 360 against a
# steady 251 / 239 / 235), and NOTHING IN ANY LOG SAYS WHAT THAT FRESH
# INPUT IS. Fresh is one number per request; a tool result, replayed
# output and replayed reasoning are indistinguishable inside it. Only a
# request body separates them, and until now neither arm recorded one.
#
# NOT A SCORED ROUND, and the distinction is load-bearing: a proxy sits in
# one arm's request path, which is a new failure mode between that arm and
# its vendor. No verdict is read off these legs; the frozen criteria are
# not applied; the composition table is the whole output.
#
# PER ARM, WHICH CAPTURE AND WHY:
#
#   ours    KISO_DUMP_REQUESTS — the adapter's own sink. It must NOT be
#           proxied: a loopback baseUrl defeats the endpoint-keyed metadata
#           lookup (dispatch.ts: lookupModelMetadata(model, baseUrl)), so
#           `/model ds high` is refused and every leg reads
#           effort_not_bound. The round would be void, after the money.
#   theirs  the capture proxy, redirected through its MODEL STORE — one
#           file, DECLARED to the bareness gate rather than hidden from it.
#           Environment variables are not honoured by that arm; the older
#           note saying so stands and is about env vars, not this route.
#
# THE BUILD IS PACKED AND INSTALLED FROM main, not `node <path>`. That is
# not ceremony: `node <path>` made the capture walk up from the node binary
# and record the artifact under test as `{"name":"nvm"}`. Packed, it
# records `@vincemakes/kiso-code`. A benchmark that cannot name what it
# measured is not evidence.
#
# BOTH ARMS' EFFORT IS WIRE-VERIFIED here, for the first time. Ours reads
# back from the durable profile AND from its dumped bodies; theirs from its
# captured bodies, which a free offline pre-flight proved carry
# `reasoning_effort: "high"` and `thinking: {"type":"enabled"}` through the
# proxy. A leg whose arm shows no wire effort is reported, never guessed.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
: "${DEEPSEEK_API_KEY:?set DEEPSEEK_API_KEY before running}"
export KISO_ROUND=${KISO_ROUND:-t6-capture}
export KISO_BIN="${KISO_BIN:-/private/tmp/kiso-install/node_modules/.bin/kiso}"
export KISO_VERSION=${KISO_VERSION:-0.36.0}
export BENCH_EFFORT=${BENCH_EFFORT:-high}
export BENCH_CAPTURE=1

say() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$1"; }

check_leg() { # $1=tool  $2=run
	W="$B/runs/$KISO_ROUND/$1-T6-$2"
	_st=$(cat "$W/status" 2>/dev/null || echo missing)
	_vf=$(cat "$W/verify" 2>/dev/null || echo missing)
	_ef=$(cat "$W/effort_bound" 2>/dev/null || echo "n/a")
	_ew=$(cat "$W/effort_wire" 2>/dev/null || echo missing)
	_cap=$(node -e 'try{const r=require(process.argv[1]);console.log(r.ok?("ok "+r.checked+" bodies"):("PROBLEM: "+r.problems.join("; ")))}catch{console.log("no capture record")}' "$W/capture.json" 2>/dev/null || echo "unreadable")
	say "  $1-$2: status=$_st verify=$_vf profile-effort=$_ef wire-effort=$_ew"
	say "         capture: $_cap"
	# A DIAGNOSTIC LEG IS NOT VOIDED BY ITS TASK VERDICT — no verdict is read
	# off it. It is voided by being unable to say what it ran.
	[ "$_st" = complete ] && [ "$_ew" = "$BENCH_EFFORT" ]
}

VOID=0
for P in 1 2 3; do
	if [ $((P % 2)) -eq 1 ]; then ORDER="kiso pi"; else ORDER="pi kiso"; fi
	for TOOL in $ORDER; do
		say "pair $P — $TOOL"
		sh "$B/run-t6.sh" "$TOOL" "c$P" || say "  the runner exited nonzero"
		check_leg "$TOOL" "c$P" || VOID=$((VOID + 1))
	done
done

say "done — $VOID leg(s) could not say what they ran"
[ "$VOID" -eq 0 ] || say "A LEG THAT CANNOT NAME ITS OWN EFFORT IS NOT A DATA POINT."
