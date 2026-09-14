#!/bin/sh
# The runner's LIFECYCLE, with no model and no money.
#
# What this exercises is everything around the model call: does each arm
# write a status, a verify record and its per-invocation exit codes; does a
# nonzero exit become `incomplete:launch_or_run_error` rather than a task
# verdict; does the manifest come out with the served-model aggregate.
#
# Astra ran these by hand to find F33-R6 (SEG_FAILURE declared inside ONE
# arm while the completion decision at the end is shared by all three, so
# the other two hit `set -u` AFTER their work and left no record). A
# substitute binary reproduces that in a second; the real leg takes forty
# minutes and ¥1. The substitutes do NOT implement the task, so the task
# verifier returns fail — that is expected and is not what is under test.
set -u
B=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILED=0
note() { printf '  %-4s %s\n' "$1" "$2"; [ "$1" = "RED" ] && FAILED=1; return 0; }

# substitutes on PATH, ahead of anything real
mkdir -p "$TMP/bin"
for t in kiso pi claude; do
	cat > "$TMP/bin/$t" <<EOF
#!/bin/sh
# ARGUMENTS FIRST. The first version drained stdin before looking at them,
# so \`--version\` blocked on a pipe nobody closed and three legs hung with
# a twenty-second deadline set. That hang was the finding: the runner's
# version probe ran before any bounding machinery existed. The substitute
# now answers the probe without reading anything, which is what a real
# \`--version\` does.
case "\$1" in --version) echo "9.9.9"; exit 0 ;; esac
cat > /dev/null 2>&1 || true
# the exit code travels in a FILE, not the environment: bare_bounded
# strips the environment on purpose, so an env-borne code reached the kiso
# arm and vanished on the other two — and the smoke read that as the
# runner failing to classify them.
[ -f "$TMP/exit-code" ] && exit "\$(cat "$TMP/exit-code")"
exit 0
EOF
	chmod +x "$TMP/bin/$t"
done
PATH="$TMP/bin:$PATH"
export PATH
# the runner sources a credentials file; a smoke must not need real keys
mkdir -p "$TMP/cfg/claude-deepseek"
echo 'DEEPSEEK_API_KEY=smoke-not-a-key' > "$TMP/cfg/claude-deepseek/credentials.env"
XDG_CONFIG_HOME="$TMP/cfg"; export XDG_CONFIG_HOME
KISO_BIN=kiso; export KISO_BIN
KISO_ROUND=offline-smoke; export KISO_ROUND
LEG_MAX_REQUESTS=4; export LEG_MAX_REQUESTS
LEG_DEADLINE_S=20; export LEG_DEADLINE_S

for tool in kiso pi claude; do
	W="$B/runs/offline-smoke/$tool-T5-s1"
	rm -rf "$W"
	rm -f "$TMP/exit-code"
	if out=$(sh "$B/run-t5.sh" "$tool" s1 2>&1); then
		note ok "$tool: the runner completed"
	else
		note RED "$tool: the runner exited nonzero — $(printf '%s' "$out" | tail -1)"
	fi
	[ -f "$W/verify" ] && note ok "$tool: a verify record exists" || note RED "$tool: NO verify record (F33-R6's symptom)"
	[ -f "$W/status" ] && note ok "$tool: a status exists" || note RED "$tool: NO status"
	[ -f "$W/config.json" ] && note ok "$tool: a manifest exists" || note RED "$tool: NO manifest"
done

echo "  --- a nonzero exit is OURS, never the task's verdict ---"
for tool in kiso pi claude; do
	W="$B/runs/offline-smoke/$tool-T5-s2"
	rm -rf "$W"
	echo 3 > "$TMP/exit-code"
	sh "$B/run-t5.sh" "$tool" s2 >/dev/null 2>&1
	rm -f "$TMP/exit-code"
	if [ -f "$W/status" ] && grep -q "launch_or_run_error" "$W/status" 2>/dev/null; then
		note ok "$tool: classified as launch_or_run_error"
	else
		note RED "$tool: exit 3 was NOT classified ($(cat "$W/status" 2>/dev/null || echo 'no status'))"
	fi
done

echo "  --- the effort must be BOUND, not merely typed ---"
# The substitute runs cleanly and writes no durable profile, so the switch
# was typed and never took. That is the shape a REFUSED `/model` has, and
# an arm labelled `high` whose requests were never high is worse than a
# failed leg: it gets scored.
W="$B/runs/offline-smoke/kiso-T5-s3"
rm -rf "$W"; rm -f "$TMP/exit-code"
sh "$B/run-t5.sh" kiso s3 >/dev/null 2>&1
if grep -q "effort_not_bound" "$W/status" 2>/dev/null; then
	note ok "kiso: a clean run with no binding is incomplete, not scored"
else
	note RED "kiso: an unbound effort was accepted ($(cat "$W/status" 2>/dev/null || echo 'no status'))"
fi
# and the ORDER: a leg that never ran reports why it never ran, not the
# binding it could not have made
W="$B/runs/offline-smoke/kiso-T5-s4"
rm -rf "$W"; echo 3 > "$TMP/exit-code"
sh "$B/run-t5.sh" kiso s4 >/dev/null 2>&1
rm -f "$TMP/exit-code"
if grep -q "launch_or_run_error" "$W/status" 2>/dev/null; then
	note ok "kiso: a failed run reports the FAILURE, not the unbound effort"
else
	note RED "kiso: the consequence was reported in place of the cause ($(cat "$W/status" 2>/dev/null || echo '-'))"
fi

rm -rf "$B/runs/offline-smoke"
[ "$FAILED" -eq 0 ] && echo "[offline-runner-smoke] the lifecycle holds on all three arms" || echo "[offline-runner-smoke] RED"
exit "$FAILED"
