#!/bin/sh
# The limits are only worth having if what they leave behind is usable.
set -eu
B="$(cd "$(dirname "$0")/.." && pwd)"
export B
. "$B/leg-limits.sh"
P=0; F=0
ok()   { printf "  ok   %s\n" "$1"; P=$((P+1)); }
bad()  { printf "  FAIL %s\n" "$1"; F=$((F+1)); }

# 1. a command inside the bound finishes normally
W=$(mktemp -d)
run_bounded 10 "$W/log" /bin/sh -c 'echo hello; exit 0' && rc=0 || rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$W/log")" = "hello" ] && ok "a command inside the bound completes, log intact" || bad "inside the bound"

# 2. a hung command is killed AT the deadline, not left running
W2=$(mktemp -d)
S=$(date +%s)
run_bounded 2 "$W2/log" /bin/sh -c 'echo starting; sleep 60' && rc=0 || rc=$?
E=$(date +%s); EL=$((E-S))
[ "$EL" -lt 10 ] && ok "a hung command is killed at the deadline (${EL}s, not 60)" || bad "deadline not enforced (${EL}s)"

# 3. THE PARTIAL LOG SURVIVES — a killed leg's output is evidence
grep -q starting "$W2/log" && ok "the partial log survives the kill" || bad "partial log lost"

# 4. the status says INCOMPLETE and why — never 'fail'
mark_incomplete "$W2" deadline "killed at 2s"
[ "$(cat "$W2/status")" = "incomplete:deadline" ] && ok "status is incomplete:deadline, not fail" || bad "status wrong"
grep -q "killed at 2s" "$W2/status_detail" && ok "the reason is recorded beside it" || bad "no reason"

# 5. a completed leg says so
W3=$(mktemp -d); mark_complete "$W3"
[ "$(cat "$W3/status")" = "complete" ] && ok "a finished leg is marked complete" || bad "complete not marked"

# 6. the request counter reads what is on disk, and is zero when nothing ran
W4=$(mktemp -d); mkdir -p "$W4/kiso-home/sessions"
[ "$(requests_so_far "$W4" kiso)" -eq 0 ] && ok "no usage on disk reads as zero requests" || bad "phantom requests"
printf '{"event":{"type":"usage","inputTokens":1}}\n{"event":{"type":"usage","inputTokens":2}}\n' > "$W4/kiso-home/sessions/s.jsonl"
[ "$(requests_so_far "$W4" kiso)" -eq 2 ] && ok "two usage records read as two requests" || bad "miscount: $(requests_so_far "$W4" kiso)"

# 7. the counter works for a comparator's log shape too
W5=$(mktemp -d)
printf '{"type":"message_end","message":{"usage":{"input":1}}}\n' > "$W5/stdout-1.log"
[ "$(requests_so_far "$W5" pi)" -ge 1 ] && ok "a comparator's log is counted too" || bad "comparator not counted"

# 8. the counter must work when leg-limits.sh is SOURCED FROM ELSEWHERE.
#    `$0` in a sourced file names the sourcing script, so resolving the
#    helper from it found nothing from bench/tests/ while working by luck
#    from bench/. This test is run from bench/tests/, which is the case that
#    was broken.
W6=$(mktemp -d); mkdir -p "$W6/kiso-home/sessions"
printf '{"event":{"type":"usage","inputTokens":1}}\n' > "$W6/kiso-home/sessions/s.jsonl"
[ "$(requests_so_far "$W6" kiso)" -eq 1 ] && ok "the counter resolves its helper when sourced from another directory" || bad "helper not found when sourced from elsewhere"

echo
echo "[leg-limits] $P ok, $F failed"
[ "$F" -eq 0 ]
