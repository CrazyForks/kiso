#!/bin/sh
# T5 verify — the final checks after the 8 progressive turns, in THREE parts.
#
# THE TESTS COME FROM THE FIXTURE, NEVER FROM THE WORKSPACE.
#
# The whole fixture, `tests/` included, is copied into the workspace the
# agent edits with write and shell access. Running the workspace's own tests
# asked the agent to mark its own paper: rewriting `tests/range.test.js` to
# exit 0 passed the verifier without touching a line of `src/`. That is the
# difference between DONE and CLAIMS DONE, and a bar an arm can move is not
# a bar.
#
# So the reference tests are copied out of the fixture at verify time and run
# against the workspace's `src/`. The agent's edits to `tests/` are ignored —
# they are not wrong to make, they are simply not evidence.
#
# 2026-09-15: the other two parts, after the T6 round found a leg that
# passed every visible check and still answered 1 where 0 was correct.
#   BOUNDARY — t5-holdout/boundary.test.mjs, outside fixture-t5/ so the
#     `cp -R` that builds a leg never reaches it. Every assertion cites the
#     turn that states it; nothing new is asked of an arm.
#   SCOPE — which files the leg changed, split by whether a turn names them.
#     REPORTED, NEVER GATED: a harmless refactor is not a failure, and the
#     way to learn what wasted work looks like is to measure it.
#
# THE PREDICATE CHANGED AND THE VERDICT IS NOT COMPARABLE ACROSS THAT LINE.
# `pass` used to mean part 1 alone; it now means 1 AND 2. A pass rate from
# before this date and one from after answer different questions.
set -eu
WORK="$1"
OUT="${2:-}"          # optional: a directory to write verify.json into
VERIFY_PREDICATE=2    # 1 = contract only (before 2026-09-15); 2 = + boundary
B="$(cd "$(dirname "$0")" && pwd)"
FIXTURE="$B/fixture-t5"
HOLDOUT="$B/t5-holdout/boundary.test.mjs"

emit() { # $1=verdict  $2=json body
	if [ -n "$OUT" ]; then
		printf '{"verdict":"%s","predicate":%s,%s}\n' "$1" "$VERIFY_PREDICATE" "$2" > "$OUT/verify.json"
	fi
	echo "$1"
	exit 0
}

[ -d "$FIXTURE/tests" ] || emit fail '"error":"the fixture tests are missing"'
[ -f "$HOLDOUT" ]       || emit fail '"error":"the holdout checks are missing"'

ARENA=$(mktemp -d /tmp/t5-verify.XXXXXX)
trap 'rm -rf "$ARENA"' EXIT
cp -R "$WORK/src" "$ARENA/src" 2>/dev/null || emit fail '"error":"the leg has no src/"'
cp -R "$FIXTURE/tests" "$ARENA/tests"
[ -f "$WORK/package.json" ] && cp "$WORK/package.json" "$ARENA/" 2>/dev/null || true

# ---- 1. contract -----------------------------------------------------
CONTRACT_FAILED=""
cd "$ARENA"
for t in range report; do
	node "tests/$t.test.js" >/dev/null 2>&1 || CONTRACT_FAILED="$CONTRACT_FAILED tests/$t.test.js"
done
_got=$(node src/cli.js --count '1-2,3-4' 2>/dev/null | tail -1) || _got=""
[ "$_got" = "2" ] || CONTRACT_FAILED="$CONTRACT_FAILED --count"
# Turn 7 prints "the number of ranges in the second argument"; turn 5 makes
# that number 0 for the empty text. A cli check, so it lives here and not in
# the module holdout.
_got=$(node src/cli.js --count '' 2>/dev/null | tail -1) || _got=""
[ "$_got" = "0" ] || CONTRACT_FAILED="$CONTRACT_FAILED --count''"

# ---- 2. boundary ------------------------------------------------------
# A crash must not read as a clean sheet: an unparseable result is a
# boundary FAILURE, not an absence.
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
# Turns 1-5 name src/range.js, turn 6 names src/report.js, turn 7 names
# src/cli.js. Nothing names src/user.js, the README, package.json or tests/.
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
