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
# LB-1: the legs live outside the checkout — a checkout may carry an
# untracked instruction file, and the runners' isolation gate voids any leg
# beneath one (leg-isolation.sh)
RUNS=$(cd "$(mktemp -d)" && pwd -P)/runs; export KISO_RUNS_ROOT="$RUNS"
KISO_ROUND=offline-smoke; export KISO_ROUND
# RUNNER-R2 (Astra): the PUBLIC override names, which is what the runner
# reads. The smoke used to export LEG_MAX_REQUESTS and LEG_DEADLINE_S, and
# the runner unconditionally sets those from the KISO_-prefixed ones — so
# the smoke declared 20s/4 and every leg actually ran with 1800s/200. A
# harness that states a bound it does not set is worse than one with no
# bound: it is a bound nobody will check again.
#
# Three names for one idea was the cause: the runner read KISO_LEG_*, the
# probe read an unprefixed PROBE_DEADLINE_S, and the smoke exported the
# unprefixed leg names. They are all KISO_-prefixed now.
KISO_LEG_MAX_REQUESTS=4; export KISO_LEG_MAX_REQUESTS
KISO_LEG_DEADLINE_S=20; export KISO_LEG_DEADLINE_S
KISO_PROBE_DEADLINE_S=${KISO_PROBE_DEADLINE_S:-10}; export KISO_PROBE_DEADLINE_S

for tool in kiso pi claude; do
	W="$RUNS/offline-smoke/$tool-T5-s1"
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
	# RUNNER-R2: the limits this smoke DECLARED, read back from what the
	# runner actually recorded. Exporting the right names is not evidence
	# that they took — the previous names were exported too, and the legs
	# ran at 1800/200 while this file said 20/4.
	eff=$(node -e 'const j=require(process.argv[1]);console.log(j.legDeadlineSeconds+"/"+j.legMaxRequests)' "$W/config.json" 2>/dev/null || echo "?")
	if [ "$eff" = "$KISO_LEG_DEADLINE_S/$KISO_LEG_MAX_REQUESTS" ]; then
		note ok "$tool: the declared limits are the effective ones ($eff)"
	else
		note RED "$tool: declared $KISO_LEG_DEADLINE_S/$KISO_LEG_MAX_REQUESTS, the manifest records $eff"
	fi
done

echo "  --- a nonzero exit is OURS, never the task's verdict ---"
for tool in kiso pi claude; do
	W="$RUNS/offline-smoke/$tool-T5-s2"
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
W="$RUNS/offline-smoke/kiso-T5-s3"
rm -rf "$W"; rm -f "$TMP/exit-code"
sh "$B/run-t5.sh" kiso s3 >/dev/null 2>&1
if grep -q "effort_not_bound" "$W/status" 2>/dev/null; then
	note ok "kiso: a clean run with no binding is incomplete, not scored"
else
	note RED "kiso: an unbound effort was accepted ($(cat "$W/status" 2>/dev/null || echo 'no status'))"
fi
# and the ORDER: a leg that never ran reports why it never ran, not the
# binding it could not have made
W="$RUNS/offline-smoke/kiso-T5-s4"
rm -rf "$W"; echo 3 > "$TMP/exit-code"
sh "$B/run-t5.sh" kiso s4 >/dev/null 2>&1
rm -f "$TMP/exit-code"
if grep -q "launch_or_run_error" "$W/status" 2>/dev/null; then
	note ok "kiso: a failed run reports the FAILURE, not the unbound effort"
else
	note RED "kiso: the consequence was reported in place of the cause ($(cat "$W/status" 2>/dev/null || echo '-'))"
fi

echo "  --- the T6 runner, ported to the same apparatus ---"
# It was eight generations behind: no bare HOME, no limits at all, exit
# codes discarded, no third arm. The port is only real if it holds the same
# lifecycle, so it is checked by the same substitutes.
for tool in kiso pi claude; do
	W="$RUNS/offline-smoke/$tool-T6-s1"
	rm -rf "$W"; rm -f "$TMP/exit-code"
	sh "$B/run-t6.sh" "$tool" s1 >/dev/null 2>&1
	[ -f "$W/verify" ] && note ok "$tool T6: a verify record exists" || note RED "$tool T6: NO verify record"
	[ -f "$W/status" ] && note ok "$tool T6: a status exists" || note RED "$tool T6: NO status"
	[ -f "$W/config.json" ] && note ok "$tool T6: a manifest exists" || note RED "$tool T6: NO manifest"
	# the curve's own shape: four buckets, four walls, for every arm
	n=$(ls "$W"/wall_[1-4] 2>/dev/null | wc -l | tr -d " ")
	[ "$n" = 4 ] && note ok "$tool T6: four bucket walls" || note RED "$tool T6: $n bucket walls, expected 4"
done

echo "  --- and a nonzero exit is OURS on the T6 arms too ---"
for tool in kiso pi claude; do
	W="$RUNS/offline-smoke/$tool-T6-s2"
	rm -rf "$W"; echo 3 > "$TMP/exit-code"
	sh "$B/run-t6.sh" "$tool" s2 >/dev/null 2>&1
	rm -f "$TMP/exit-code"
	grep -q "launch_or_run_error" "$W/status" 2>/dev/null \
		&& note ok "$tool T6: classified as launch_or_run_error" \
		|| note RED "$tool T6: exit 3 not classified ($(cat "$W/status" 2>/dev/null || echo none))"
done

echo "  --- a leg's git cannot reach the host ---"
# A T6 leg ran `git stash ... ; git stash pop` against HEAD. With no
# repository of its own the fixture sat inside the HOST worktree, git
# walked up, and the pop landed on the operator's parked stash. The leg
# then spent most of its thinking recovering a mess that was ours.
#
# The check is not "does .git exist" — it is whether git RESOLVES to the
# leg, which is the question the failure actually turned on.
for fam in t5 t6; do
	W="$RUNS/offline-smoke/kiso-$(echo $fam | tr a-z A-Z)-s1"
	if [ -d "$W/repo" ]; then
		top=$(git -C "$W/repo" rev-parse --show-toplevel 2>/dev/null || echo "")
		case "$top" in
			"$W/repo"|"$(cd "$W/repo" 2>/dev/null && pwd -P)")
				note ok "$fam: git inside the leg resolves to the leg" ;;
			"")
				note RED "$fam: git resolves to NOTHING — commands will error, not isolate" ;;
			*)
				note RED "$fam: git inside the leg resolves to $top — it can reach the host" ;;
		esac
		# and the leg has a commit, so `git stash`/`git diff` have a base
		git -C "$W/repo" rev-parse HEAD >/dev/null 2>&1 \
			&& note ok "$fam: the leg's repo has a baseline commit" \
			|| note RED "$fam: the leg's repo has no commit — git stash has nothing to compare"
	fi
done


# ---- the verifier: the bar an arm cannot move, and the one it can -----
#
# Three properties, each proved by making it fail first.
#
#   ARENA    a leg that rewrites its own tests must still be judged on its
#            src. t5-verify.sh had this; t6-verify.sh did not until today.
#   BOUNDARY the held-out checks must FIRE on the defect that motivated
#            them and must be REACHABLE by a correct implementation. A bar
#            nothing can clear fails every arm and measures nothing.
#   SCOPE    out-of-scope edits must be REPORTED and must NOT change the
#            verdict. A wasted-work measure that punishes is a gate in
#            disguise, and arms would be failed for harmless refactors.
V="$TMP/verify-gates"; mkdir -p "$V"
sidecar() { # $1=dir with verify.json  $2=node expression over `r`
	node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval(process.argv[2]))' "$1/verify.json" "$2" 2>/dev/null
}

for fam in t5 t6; do
	# A leg that never touched src but emptied every test it was given.
	C="$V/$fam-cheat"; rm -rf "$C"; cp -R "$B/fixture-$fam" "$C"
	for f in "$C"/tests/*.test.js; do echo 'console.log("ok"); process.exit(0);' > "$f"; done
	# red side, stated out loud: the workspace's own tests all pass now
	if (cd "$C" && for t in tests/*.test.js; do node "$t" >/dev/null 2>&1 || exit 1; done); then
		O="$V/$fam-cheat-out"; mkdir -p "$O"
		verdict=$("$B/$fam-verify.sh" "$C" "$O" 2>/dev/null)
		[ "$verdict" = fail ] \
			&& note ok "$fam: the leg's own tests all pass and the verdict is still fail" \
			|| note RED "$fam: a leg that emptied its tests scored $verdict — the bar moved with it"
	else
		note RED "$fam: could not set up the cheat case (its emptied tests did not pass)"
	fi
done

# The defect three legs of three different tools shipped: Number('') is 0,
# so '' survives a finite-check and becomes the range 0-0. Everything
# downstream of parseRangeList inherits it.
mk_src() { # $1=dir  $2=empty|guarded  — starts from the FIXTURE
	# Starting from the fixture, not from hand-written files: a hand-written
	# user.js that only LOOKED like the fixture's differed by whitespace, so
	# the clean control already carried an out-of-scope entry and the scope
	# gate reported a leak that was mine. The control has to be the world.
	rm -rf "$1"; cp -R "$B/fixture-$FAM" "$1"
	if [ "$2" = guarded ]; then GUARD='if (!/^-?\d+(--?\d+)?$/.test(String(str).trim())) return null;'; else GUARD=''; fi
	cat > "$1/src/range.js" <<RG
export function parseRange(str) {
	$GUARD
	const [a, b = a] = String(str).split("-").map(Number);
	return a <= b ? { start: a, end: b } : { start: b, end: a };
}
export function parseRangeList(text) {
	return String(text).split(",").map(parseRange)
		.filter((r) => r !== null && Number.isFinite(r.start) && Number.isFinite(r.end));
}
export function clamp(n, min, max) { return n < min ? min : n > max ? max : n; }
export function isBetween(n, lo, hi) { return lo <= n && n <= hi; }
export function maxOf(v) { return v.length ? Math.max(...v) : null; }
export function minOf(v) { return v.length ? Math.min(...v) : null; }
export function sumOf(v) { return v.reduce((a, b) => a + b, 0); }
export function formatRange(a, b) { return a <= b ? \`\${a}-\${b}\` : \`\${b}-\${a}\`; }
export function startsOf(t) { return parseRangeList(t).map((r) => r.start); }
export function overlaps(a, b) { return a.start <= b.end && b.start <= a.end; }
export function mergeOverlaps(rs) {
	const out = [];
	for (const r of [...rs].sort((x, y) => x.start - y.start)) {
		const l = out[out.length - 1];
		if (l && r.start <= l.end + 1) l.end = Math.max(l.end, r.end);
		else out.push({ start: r.start, end: r.end });
	}
	return out;
}
export function everyNth(t, n) { return parseRangeList(t).filter((_, i) => i % n === 0); }
export function hasOverlap(t) {
	const r = parseRangeList(t);
	for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (overlaps(r[i], r[j])) return true;
	return false;
}
export function countDistinct(t) {
	const s = new Set();
	for (const r of parseRangeList(t)) for (let i = r.start; i <= r.end; i++) s.add(i);
	return s.size;
}
export function longestRun(t) {
	return mergeOverlaps(parseRangeList(t)).reduce((m, r) => Math.max(m, r.end - r.start + 1), 0);
}
RG
	cat > "$1/src/report.js" <<'RP'
import { formatUser } from "./user.js";
import { parseRangeList, mergeOverlaps } from "./range.js";
export function reportLine(u, c) { return `${formatUser(u)}: ${c} commits`; }
export function summarize(t) { return parseRangeList(t).length; }
export function totalSpan(t) { return parseRangeList(t).reduce((a, r) => a + (r.end - r.start + 1), 0); }
export function widest(t) {
	const r = parseRangeList(t); if (!r.length) return "";
	let b = r[0]; for (const x of r) if (x.end - x.start > b.end - b.start) b = x;
	return `${b.start}-${b.end}`;
}
export function mergedText(t) { return mergeOverlaps(parseRangeList(t)).map((r) => `${r.start}-${r.end}`).join(","); }
RP
}

for fam in t5 t6; do
	for variant in empty guarded; do
		D="$V/$fam-$variant"; FAM=$fam mk_src "$D" "$variant"
		O="$D-out"; mkdir -p "$O"
		"$B/$fam-verify.sh" "$D" "$O" >/dev/null 2>&1
		missed=$(sidecar "$O" 'r.boundary.missed.length')
		ran=$(sidecar "$O" 'r.boundary.ran')
		if [ "$variant" = empty ]; then
			{ [ "$ran" = true ] && [ -n "$missed" ] && [ "$missed" -gt 0 ]; } \
				&& note ok "$fam: the holdout names $missed boundary miss(es) on the Number('') defect" \
				|| note RED "$fam: the holdout did not fire on the defect it exists for (ran=$ran missed=$missed)"
		else
			{ [ "$ran" = true ] && [ "$missed" = 0 ]; } \
				&& note ok "$fam: a guarded implementation clears every boundary check" \
				|| note RED "$fam: the boundary bar is unreachable — a correct src missed $missed (ran=$ran)"
		fi
	done
done

# Scope: measured, never gated. Stated as a DIFFERENTIAL — the same src
# scored twice, once clean and once after wandering — rather than as
# "the wandering leg passes". The absolute form made this gate depend on
# mk_src being a COMPLETE solution to the chain, and it is not one: it has
# no cli.js, so every flag check failed and the gate reported scope gating
# a verdict that the missing file had already decided. A differential
# cannot be fooled that way, and it is the property actually claimed.
for fam in t5 t6; do
	D="$V/$fam-clean"; FAM=$fam mk_src "$D" guarded
	W="$V/$fam-wander"; rm -rf "$W"; cp -R "$D" "$W"
	printf '\n// tidied up while I was here\n' >> "$W/src/user.js"
	echo notes > "$W/NOTES.md"
	OD="$D-out"; OW="$W-out"; mkdir -p "$OD" "$OW"
	vd=$("$B/$fam-verify.sh" "$D" "$OD" 2>/dev/null)
	vw=$("$B/$fam-verify.sh" "$W" "$OW" 2>/dev/null)
	[ "$vd" = "$vw" ] \
		&& note ok "$fam: wandering outside the turns' files leaves the verdict at $vw" \
		|| note RED "$fam: the same src scored $vd clean and $vw after an out-of-scope edit — scope is gating"
	out=$(sidecar "$OW" 'r.scope.outOfScope.join(",")')
	added=$(sidecar "$OW" 'r.scope.added.join(",")')
	clean_out=$(sidecar "$OD" 'r.scope.outOfScope.length + r.scope.added.length')
	{ [ "$out" = "src/user.js" ] && [ "$added" = "NOTES.md" ] && [ "$clean_out" = 0 ]; } \
		&& note ok "$fam: the sidecar names the out-of-scope edit, and names nothing when there is none" \
		|| note RED "$fam: scope reported outOfScope=[$out] added=[$added] (clean leg: $clean_out entries)"
done


# ---- the A/B switch reaches the product, or the experiment is void ----
#
# BENCH_EDIT_ECHO must survive `bare_bounded`, which strips the environment
# on purpose and rebuilds it from an explicit whitelist. A variable that
# never arrives makes the B arm behave exactly like the A arm, and the two
# agree because they are the same arm — an experiment destroyed silently,
# with a result that looks like a clean null.
cat > "$TMP/bin/envprobe" <<'EP'
#!/bin/sh
case "$1" in --version) echo "9.9.9"; exit 0 ;; esac
cat > /dev/null 2>&1 || true
echo "KISO_EDIT_ECHO=${KISO_EDIT_ECHO:-<unset>}"
EP
chmod +x "$TMP/bin/envprobe"
for want in 0 1; do
	out="$TMP/echo-plumb-$want.log"
	( cd "$B" && BENCH_EDIT_ECHO=$want KISO_BIN="$TMP/bin/envprobe" KISO_VERSION=9.9.9 \
		KISO_ROUND=offline-echo DEEPSEEK_API_KEY=x KISO_LEG_DEADLINE_S=60 \
		sh ./run-t6.sh kiso "e$want" >/dev/null 2>&1 )
	got=$(cat "$RUNS/offline-echo/kiso-T6-e$want/stdout-1.log" 2>/dev/null | grep -m1 '^KISO_EDIT_ECHO=' || echo "")
	case "$want:$got" in
		"1:KISO_EDIT_ECHO=1") note ok "BENCH_EDIT_ECHO=1 reaches the binary as KISO_EDIT_ECHO=1" ;;
		"0:KISO_EDIT_ECHO=<unset>") note ok "BENCH_EDIT_ECHO=0 leaves the binary with no KISO_EDIT_ECHO" ;;
		*) note RED "BENCH_EDIT_ECHO=$want produced [$got] at the binary — the arms are not distinct" ;;
	esac
done
rm -rf "$RUNS/offline-echo"

# And the leg's OWN evidence decides which arm it was. `effort_bound` taught
# this: a label a leg carries must be read back from what the leg did, never
# from what it was asked to do. `none` is a third value on purpose — a leg
# that made no successful edit cannot testify either way.
ECHO_FIX="$TMP/echo-detect"; mkdir -p "$ECHO_FIX"
mk_log() { # $1=dir  $2=on|off|none
	mkdir -p "$1/kiso-home/sessions"
	L="$1/kiso-home/sessions/s.jsonl"
	: > "$L"
	printf '%s\n' '{"event":{"type":"tool_call_start","callId":"c1","name":"edit_file"}}' >> "$L"
	case "$2" in
		on)   printf '%s\n' '{"event":{"type":"tool_result","callId":"c1","isError":false,"content":"edited src/a.js\n@@ 3-5 @@\n 3 x\n 4 y\n 5 z\n[rev:00]"}}' >> "$L" ;;
		off)  printf '%s\n' '{"event":{"type":"tool_result","callId":"c1","isError":false,"content":"edited src/a.js\n[rev:00]"}}' >> "$L" ;;
		none) printf '%s\n' '{"event":{"type":"tool_result","callId":"c1","isError":true,"content":"edit_file: pattern not found"}}' >> "$L" ;;
	esac
}
detect() { node -e '
const fs=require("fs"),p=require("path");
const d=process.argv[1]+"/kiso-home/sessions";
let names={},saw=0,edits=0;
try{
  const f=fs.readdirSync(d).find(x=>x.endsWith(".jsonl")&&!x.includes("trace"));
  for(const line of fs.readFileSync(p.join(d,f),"utf8").split("\n")){
    if(!line.trim())continue; let o; try{o=JSON.parse(line);}catch{continue}
    const e=o.event||o;
    if(e.type==="tool_call_start")names[e.callId]=e.name;
    if(e.type==="tool_result"&&names[e.callId]==="edit_file"&&!e.isError){
      edits++; if(/^@@ \d+-\d+ @@$/m.test(String(e.content||"")))saw++; }
  }
}catch{}
process.stdout.write(edits===0?"none":(saw>0?"on":"off"));
' "$1"; }
for want in on off none; do
	mk_log "$ECHO_FIX/$want" "$want"
	got=$(detect "$ECHO_FIX/$want")
	[ "$got" = "$want" ] \
		&& note ok "a leg whose edits carried '$want' is read back as $want" \
		|| note RED "a leg whose edits carried '$want' was read back as '$got'"
done


# ---- the frozen criteria and the script that applies them must agree ---
if [ -f "$B/kits/edit-echo-ab.md" ] && [ -f "$B/edit-echo-verdict.mjs" ]; then
	agree=$(node "$B/tests/criteria-agree.mjs" "$B/kits/edit-echo-ab.md" "$B/edit-echo-verdict.mjs" edit-echo 2>&1 || echo "the comparison itself failed")
	if [ "$agree" = agree ]; then
		note ok "the edit-echo verdict's margins match its frozen kit"
	else
		note RED "the edit-echo verdict and its frozen kit disagree: $agree"
	fi
fi
if [ -f "$B/kits/tool-table-a.md" ] && [ -f "$B/tool-table-verdict.mjs" ]; then
	agree=$(node "$B/tests/criteria-agree.mjs" "$B/kits/tool-table-a.md" "$B/tool-table-verdict.mjs" tool-table 2>&1 || echo "the comparison itself failed")
	if [ "$agree" = agree ]; then
		note ok "round A's verdict margins match its frozen kit"
	else
		note RED "round A's verdict and its frozen kit disagree: $agree"
	fi
fi

rm -rf "$RUNS/offline-smoke"
[ "$FAILED" -eq 0 ] && echo "[offline-runner-smoke] the lifecycle holds on all three arms" || echo "[offline-runner-smoke] RED"
exit "$FAILED"
