#!/bin/sh
# The launch bench's pre-flight gates (leg-isolation.sh; finding LB-1): a
# leg whose git walks up, or that sits beneath an instruction file, is VOID
# before it spends a request. Free: no model, no credential.
set -eu
B="$(cd "$(dirname "$0")/.." && pwd)"
. "$B/leg-isolation.sh"
P=0; F=0
ok()   { printf "  ok   %s\n" "$1"; P=$((P+1)); }
bad()  { printf "  FAIL %s\n" "$1"; F=$((F+1)); }
# a real temp root, with no instruction file above it (checked, not assumed)
ROOT=$(cd "$(mktemp -d)" && pwd -P)
d=$ROOT; while :; do for f in $LEG_ANCESTOR_FILES; do [ -e "$d/$f" ] && { echo "the temp root sits beneath $d/$f — cannot test here" >&2; exit 2; }; done; [ "$d" = / ] && break; d=$(dirname "$d"); done

leg() { # $1=work — a leg repo with its own git and one commit
	mkdir -p "$1/repo"; echo x > "$1/repo/a.txt"
	git -C "$1/repo" init -q; git -C "$1/repo" add -A
	git -C "$1/repo" -c user.email=b@l -c user.name=b -c commit.gpgsign=false commit -q -m base
}

# 1. an isolated leg passes and writes no void
W="$ROOT/clean/leg"; leg "$W"
assert_leg_isolated "$W" "$W/repo" && [ ! -e "$W/void" ] && ok "an isolated leg passes" || bad "an isolated leg was refused: $(cat "$W/void" 2>/dev/null)"

# 2. an ancestor CLAUDE.md voids the leg, and says where
mkdir -p "$ROOT/claude"; echo "instructions" > "$ROOT/claude/CLAUDE.md"
W="$ROOT/claude/runs/leg"; leg "$W"
if assert_leg_isolated "$W" "$W/repo"; then bad "an ancestor CLAUDE.md passed"; else grep -q "$ROOT/claude/CLAUDE.md" "$W/void" && ok "an ancestor CLAUDE.md voids the leg, naming the file" || bad "void reason: $(cat "$W/void")"; fi

# 2b. an ancestor AGENTS.md — the name the other arm reads first
mkdir -p "$ROOT/agents"; echo "instructions" > "$ROOT/agents/AGENTS.md"
W="$ROOT/agents/runs/leg"; leg "$W"
if assert_leg_isolated "$W" "$W/repo"; then bad "an ancestor AGENTS.md passed"; else grep -q "$ROOT/agents/AGENTS.md" "$W/void" && ok "an ancestor AGENTS.md voids the leg, naming the file" || bad "void reason: $(cat "$W/void")"; fi

# 3. an ancestor .kiso voids it too
mkdir -p "$ROOT/kiso/.kiso"
W="$ROOT/kiso/runs/leg"; leg "$W"
if assert_leg_isolated "$W" "$W/repo"; then bad "an ancestor .kiso passed"; else grep -q ".kiso" "$W/void" && ok "an ancestor .kiso voids the leg" || bad "void reason: $(cat "$W/void")"; fi

# 4. git that walks UP to a host repository voids it (the 2026-09-15 stash)
mkdir -p "$ROOT/host"; git -C "$ROOT/host" init -q
W="$ROOT/host/runs/leg"; mkdir -p "$W/repo"; echo x > "$W/repo/a.txt"
if assert_leg_isolated "$W" "$W/repo"; then bad "a leg inside a host repo passed"; else grep -q "git resolves the leg repo to $ROOT/host" "$W/void" && ok "git walking up to a host repo voids the leg" || bad "void reason: $(cat "$W/void")"; fi

# 5. no repository at all voids it (git has nowhere of its own to land)
W="$ROOT/bare/leg"; mkdir -p "$W/repo"
if assert_leg_isolated "$W" "$W/repo"; then bad "a leg with no repository passed"; else grep -q "<no repository>" "$W/void" && ok "a leg with no repository voids" || bad "void reason: $(cat "$W/void")"; fi

# 6. THE RUNNER stops before any request: a T5 leg beneath CLAUDE.md exits 3
#    with its void written, and no arm output exists (nothing was launched)
set +e
KISO_RUNS_ROOT="$ROOT/claude/runs" KISO_ROUND=gate sh "$B/run-t5.sh" pi gate1 >/dev/null 2>&1
rc=$?
set -e
W="$ROOT/claude/runs/gate/pi-T5-gate1"
if [ "$rc" -eq 3 ] && [ -s "$W/void" ] && ! ls "$W"/stdout-* >/dev/null 2>&1; then ok "run-t5.sh stops a contaminated leg before its first request (exit 3, void, no arm output)"; else bad "run-t5.sh: rc=$rc void=$(cat "$W/void" 2>/dev/null || echo none)"; fi

# 7. the same, beneath AGENTS.md, for the T6 runner (and so every concealed leg)
set +e
KISO_RUNS_ROOT="$ROOT/agents/runs" KISO_ROUND=gate sh "$B/run-t6.sh" pi gate2 >/dev/null 2>&1
rc=$?
set -e
W="$ROOT/agents/runs/gate/pi-T6-gate2"
if [ "$rc" -eq 3 ] && grep -q "AGENTS.md" "$W/void" 2>/dev/null && ! ls "$W"/stdout-* >/dev/null 2>&1; then ok "run-t6.sh stops a leg beneath AGENTS.md before its first request (exit 3, void, no arm output)"; else bad "run-t6.sh: rc=$rc void=$(cat "$W/void" 2>/dev/null || echo none)"; fi
# The runners always give a leg its own repository (git init), so the
# walk-up gate cannot be reached through them; case 4 proves it red on the
# gate itself, which both runners call.

echo "[leg-isolation] $P ok, $F failed"
[ "$F" -eq 0 ]
