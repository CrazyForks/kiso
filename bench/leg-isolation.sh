# leg-isolation.sh — sourced by the runners. The two pre-flight gates every
# leg passes before it spends a request (the lead's conditions 1 and 2 for
# the launch bench; finding LB-1).
#
# 1. GIT RESOLVES TO THE LEG. The leg repo must be its own git toplevel, by
#    RESOLUTION and not by presence: on 2026-09-15 a leg with no repository
#    of its own walked up to the host worktree and popped the operator's
#    stash. `rev-parse --show-toplevel` is what the arm's own git calls will
#    see, so it is what is asked.
# 2. NO ANCESTOR CARRIES AN INSTRUCTION FILE. The reference implementation
#    loads AGENTS.override.md / AGENTS.md / CLAUDE.md from EVERY ancestor up
#    to `/`; kiso reads its cwd only. A leg beneath such a file feeds it to
#    one arm and not the other. `.kiso` is refused too: a project config in
#    an ancestor is a trust question the fixture never asked.
#
# Either failure writes <work>/void with the reason and returns 1 — the
# runner stops the leg before its first request. A void leg is reported,
# never rescored. Legs therefore live under KISO_RUNS_ROOT outside any
# checkout that carries such a file (the launch bench: /private/tmp/...).

LEG_ANCESTOR_FILES="AGENTS.override.md AGENTS.md CLAUDE.md .kiso"

# runs_root <bench dir> — where legs live: KISO_RUNS_ROOT, else <bench>/runs.
runs_root() {
	printf '%s\n' "${KISO_RUNS_ROOT:-$1/runs}"
}

# assert_leg_isolated <work> <repo>
assert_leg_isolated() {
	_iso_work=$1
	_iso_real=$(cd "$2" && pwd -P) || { printf 'VOID: the leg repo %s does not exist\n' "$2" > "$_iso_work/void"; return 1; }
	_iso_top=$(git -C "$_iso_real" rev-parse --show-toplevel 2>/dev/null || true)
	_iso_top_real=""
	[ -n "$_iso_top" ] && _iso_top_real=$(cd "$_iso_top" && pwd -P)
	if [ "$_iso_top_real" != "$_iso_real" ]; then
		printf 'VOID: git resolves the leg repo to %s, not to itself (%s)\n' "${_iso_top_real:-<no repository>}" "$_iso_real" > "$_iso_work/void"
		return 1
	fi
	_iso_d=$(dirname "$_iso_real")
	while :; do
		for _iso_f in $LEG_ANCESTOR_FILES; do
			if [ -e "$_iso_d/$_iso_f" ]; then
				printf 'VOID: %s/%s sits above the leg — one arm reads every ancestor, the other does not\n' "$_iso_d" "$_iso_f" > "$_iso_work/void"
				return 1
			fi
		done
		[ "$_iso_d" = "/" ] && break
		_iso_d=$(dirname "$_iso_d")
	done
	return 0
}
