#!/bin/sh
# T6 verify: the final contract of the 24-turn chain, in THREE parts.
#
# THE TESTS COME FROM THE FIXTURE, NEVER FROM THE WORKSPACE. The whole
# fixture, tests/ included, is copied into the tree the agent edits with
# write and shell access, so running the workspace's own tests asked the
# agent to mark its own paper. t5-verify.sh learned this; this one had not,
# and it is the same generation gap the runner port closed.
#
# 1. CONTRACT — the fixture's tests against the workspace's src, plus the
#    six cli flag outputs (turn 24 states them; the print formats are the
#    chain's turns 14-17 and 22-23).
# 2. BOUNDARY — t6-holdout/boundary.test.mjs, which lives OUTSIDE
#    fixture-t6/ so the `cp -R` that builds a leg never reaches it. Every
#    assertion there cites the turn that states it; nothing new is asked.
# 3. SCOPE — which files the leg changed, split by whether a turn names
#    them. REPORTED, NEVER GATED: a harmless refactor is not a failure,
#    and the way to learn what wasted work looks like is to measure it,
#    not to punish it.
#
# THE PREDICATE CHANGED ON 2026-09-15 AND THE VERDICT IS NOT COMPARABLE
# ACROSS THAT LINE. `pass` used to mean part 1 only. It now means 1 AND 2.
# Re-scored, the paired round's six T6 legs were 6/6 under the old
# predicate and 5/6 under this one: kiso-T6-p3 answers 1 to
# countDistinct('') and longestRun('') where 0 is correct, and the old
# verifier called it a pass. A pass rate from before this date and one
# from after are answers to different questions. VERIFY_PREDICATE below is
# the version; the sidecar records it with every verdict.
set -eu
WORK="$1"
OUT="${2:-}"          # optional: a directory to write verify.json into
VERIFY_PREDICATE=2    # 1 = contract only (before 2026-09-15); 2 = + boundary
B="$(cd "$(dirname "$0")" && pwd)"
FIXTURE="$B/fixture-t6"
HOLDOUT="$B/t6-holdout/boundary.test.mjs"

emit() { # $1=verdict  $2=json body
	# An explicit `if`, not `[ -n "$OUT" ] && printf ...`: under `set -e` an
	# AND-OR list whose left side is false IS the statement status, and the
	# one-argument call (run-e5-leg0.sh, run-e6-leg0.sh) takes exactly that
	# branch. It survives on this shell; it should not depend on which shell.
	if [ -n "$OUT" ]; then
		printf '{"verdict":"%s","predicate":%s,%s}\n' "$1" "$VERIFY_PREDICATE" "$2" > "$OUT/verify.json"
	fi
	echo "$1"
	exit 0
}

[ -d "$FIXTURE/tests" ] || emit fail '"error":"the fixture tests are missing"'
[ -f "$HOLDOUT" ]       || emit fail '"error":"the holdout checks are missing"'

ARENA=$(mktemp -d /tmp/t6-verify.XXXXXX)
trap 'rm -rf "$ARENA"' EXIT
cp -R "$WORK/src" "$ARENA/src" 2>/dev/null || emit fail '"error":"the leg has no src/"'
cp -R "$FIXTURE/tests" "$ARENA/tests"
[ -f "$WORK/package.json" ] && cp "$WORK/package.json" "$ARENA/" 2>/dev/null || true

# ---- 1. contract -----------------------------------------------------
CONTRACT_FAILED=""
cd "$ARENA"
for t in range report user clamp; do
	node "tests/$t.test.js" >/dev/null 2>&1 || CONTRACT_FAILED="$CONTRACT_FAILED tests/$t.test.js"
done
check_cli() { # $1=flag $2=arg $3=expected
	_got=$(node src/cli.js "$1" "$2" 2>/dev/null | tail -1) || _got=""
	[ "$_got" = "$3" ] || CONTRACT_FAILED="$CONTRACT_FAILED $1"
}
check_cli --count    '1-2,3-4' 2
check_cli --span     '1-2,3-4' 4
check_cli --sum      '1-2,3-4' 4
check_cli --merged   '1-2,2-5' 1-5
check_cli --distinct '1-2,3-4' 4
check_cli --pairs    '1-2,2-3' 1

# ---- 2. boundary ------------------------------------------------------
# The holdout emits its own JSON; a crash here must not be read as a clean
# sheet, so an unparseable result is a boundary failure, not an absence.
BOUNDARY=$(node "$HOLDOUT" "$ARENA/src" 2>/dev/null || echo "")
BOUNDARY_SUMMARY=$(printf '%s' "$BOUNDARY" | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
	let r; try { r = JSON.parse(s); } catch { r = null; }
	if (!r) return console.log(JSON.stringify({ ran: false, missed: ["the holdout produced no verdict"] }));
	if (!r.loaded) return console.log(JSON.stringify({ ran: false, missed: ["src did not load: " + r.error] }));
	console.log(JSON.stringify({ ran: true, passed: r.passed.length,
		total: r.passed.length + r.failed.length,
		missed: r.failed.map((f) => f.name + " (turn " + f.turn + ")") }));
});' 2>/dev/null || echo '{"ran":false,"missed":["the holdout could not be summarised"]}')
BOUNDARY_OK=$(printf '%s' "$BOUNDARY_SUMMARY" | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
	let r; try { r = JSON.parse(s); } catch { r = null; }
	console.log(r && r.ran && r.missed.length === 0 ? "yes" : "no"); });' 2>/dev/null || echo no)

# ---- 3. scope (reported, never gated) --------------------------------
# Turns 1-10 and 18-21 name src/range.js, 11-13 name src/report.js, and
# 14-17 and 22-23 name src/cli.js. Nothing names src/user.js, the README,
# package.json or tests/ — edits there are scope expansion, which is a
# COST to measure (Astra: 88 tool calls against 61), not a wrong answer.
SCOPE=$(FIXTURE="$FIXTURE" WORK="$WORK" node -e '
const fs = require("fs"), path = require("path");
const NAMED = new Set(["src/range.js", "src/report.js", "src/cli.js"]);
const walk = (root) => {
	const out = new Map();
	const rec = (d) => {
		for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
			if (e.name === ".git" || e.name === "node_modules") continue;
			const rel = d ? d + "/" + e.name : e.name;
			if (e.isDirectory()) rec(rel);
			else out.set(rel, fs.readFileSync(path.join(root, rel)).toString());
		}
	};
	try { rec(""); } catch {}
	return out;
};
const base = walk(process.env.FIXTURE), now = walk(process.env.WORK);
const inScope = [], outOfScope = [], added = [], deleted = [];
for (const [f, v] of base) {
	if (!now.has(f)) deleted.push(f);
	else if (now.get(f) !== v) (NAMED.has(f) ? inScope : outOfScope).push(f);
}
for (const f of now.keys()) if (!base.has(f)) added.push(f);
console.log(JSON.stringify({ inScope: inScope.sort(), outOfScope: outOfScope.sort(),
	added: added.sort(), deleted: deleted.sort() }));
' 2>/dev/null || echo '{"inScope":[],"outOfScope":[],"added":[],"deleted":[],"error":"scope could not be read"}')

# ---- the verdict ------------------------------------------------------
if [ -n "$CONTRACT_FAILED" ] || [ "$BOUNDARY_OK" != yes ]; then V=fail; else V=pass; fi
FAILED_JSON=$(printf '%s' "$CONTRACT_FAILED" | tr ' ' '\n' | grep -v '^$' | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>
	console.log(JSON.stringify(s.split("\n").filter(Boolean))));' 2>/dev/null || echo '[]')
emit "$V" "\"contract\":{\"failed\":$FAILED_JSON},\"boundary\":$BOUNDARY_SUMMARY,\"scope\":$SCOPE"
