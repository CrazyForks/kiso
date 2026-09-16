#!/bin/sh
# BARE, per protocol v2 §3 — and per arm, because each product reads a
# different set of places.
#
# The calibration's first leg found the harness was bare for NO arm. Claude
# Code inherited the operator's ~/.claude.json and authenticated with the
# operator's own account key — eight turns, 26 minutes, every one a 401,
# recorded as `verify=fail`. Read without looking, that is "Claude Code
# failed the task". It never attempted the task.
#
# This is RD1B-F7 returning: the recorded confound where an arm inherits the
# real HOME. It was found and fixed for pi in RD-1B; the Claude Code arm
# still had it, and nobody asked the sibling.
#
# The inherited environment is a WHITELIST, not "whatever was set" — an
# exported ANTHROPIC_BASE_URL or an ANTHROPIC_API_KEY in the operator's shell
# is exactly the kind of thing that decides a leg's result invisibly.

# bare_home <workdir> -> prints a fresh home, created
bare_home() {
	_h="$1/bare-home"
	rm -rf "$_h"; mkdir -p "$_h"
	echo "$_h"
}

# assert_bare <arm> <home> — fail LOUDLY before a leg rather than produce a
# result nobody can attribute.
# A DECLARED injection is still reported, never waved through. The capture
# round has to place ONE file in the other arm's home — a model store whose
# baseUrl points at the recorder — and the honest way to do that is to tell
# this gate about it, not to skip the gate. Every declared path is printed
# into the leg's log, so the record says exactly what was placed; anything
# NOT declared still fails the leg. Pass declarations as $3.. (paths
# relative to the home).
assert_bare() {
	_arm=$1; _home=$2; shift 2 || true
	_declared=" $* "
	for _d in $_declared; do
		[ -n "$_d" ] && echo "DECLARED INJECTION: $_home/$_d (not bare, on purpose)" >&2
	done
	# ENUMERATE, do not wave through. The first version returned as soon as
	# a declaration mentioned the directory, so a home carrying the declared
	# file AND anything else beside it passed — the comment above claimed
	# otherwise, which is the gap worth catching in one's own work first.
	# Every file under the arm's forbidden roots must be declared BY PATH.
	if [ -n "$(printf %s "$_declared" | tr -d ' ')" ]; then
		_undeclared=""
		for _root in .pi .kiso .claude .claude.json; do
			[ -e "$_home/$_root" ] || continue
			for _f in $(cd "$_home" && find "$_root" -type f 2>/dev/null); do
				case " $_declared " in *" $_f "*) : ;; *) _undeclared="$_undeclared $_f" ;; esac
			done
		done
		if [ -n "$_undeclared" ]; then
			echo "NOT BARE: undeclared file(s) in $_home:$_undeclared" >&2
			return 1
		fi
		return 0
	fi
	case "$_arm" in
		pi)     [ ! -e "$_home/.pi" ] || { echo "NOT BARE: $_home/.pi exists" >&2; return 1; } ;;
		claude) [ ! -e "$_home/.claude.json" ] || { echo "NOT BARE: $_home/.claude.json exists" >&2; return 1; }
		        [ ! -d "$_home/.claude" ] || { echo "NOT BARE: $_home/.claude exists" >&2; return 1; } ;;
		kiso)   [ ! -e "$_home/.kiso" ] || { echo "NOT BARE: $_home/.kiso exists" >&2; return 1; } ;;
	esac
	# the operator's instruction files must not be reachable from the workspace
	return 0
}

# bare_bounded <home> <seconds> <logfile> <KEY=VAL>... -- <command>...
#
# ONE exec chain: env -i (the whitelist) -> perl's alarm (the deadline) ->
# the command. The first attempt nested them the other way round and passed
# `bare_run` — a SHELL FUNCTION — to perl's `exec`, which can only exec a
# file. Every leg produced an empty log and a 0-second wall, and the status
# said `complete`: a leg that never ran, recorded as one that finished.
bare_bounded() {
	_home=$1; _secs=$2; _log=$3; shift 3
	# Split the argument list at `--` WITHOUT losing quoting: the pairs are
	# collected into positional slots, then the command is appended after the
	# env/perl prefix. Nothing is ever re-parsed from a string.
	_pairs_n=0
	_tmp_pairs=""
	while [ $# -gt 0 ]; do
		[ "$1" = "--" ] && { shift; break; }
		_tmp_pairs="$_tmp_pairs$1
"
		_pairs_n=$((_pairs_n + 1))
		shift
	done
	# $@ is now the command. Build: env -i <whitelist> <pairs> perl <secs> <cmd>
	IFS='
'
	# shellcheck disable=SC2086
	set -- env -i PATH="$PATH" HOME="$_home" LANG="${LANG:-en_US.UTF-8}" \
		TERM="${TERM:-xterm-256color}" TMPDIR="${TMPDIR:-/tmp}" \
		$_tmp_pairs perl -e 'alarm shift; exec @ARGV or die "bare_bounded: exec failed: $!\n"' "$_secs" "$@"
	unset IFS
	# stderr goes to the LOG, never to /dev/null: silencing it once made a
	# fatal exec failure look like a clean success.
	"$@" > "$_log" 2>&1
	_rc=$?
	return $_rc
}

# bare_run <home> <KEY=VAL>... -- <command>...
#
# A FUNCTION THAT EXECS, not a string that gets re-split. The first version
# printed "env -i PATH=$PATH ..." for the caller to expand, and this PATH
# contains a directory with spaces ("Application Support/Claude/..."), so the
# expansion tore it in half and env tried to run the fragment. Every arm died
# in under a second.
#
# Build argument lists, never command strings: a string cannot carry a value
# with a space through an unquoted expansion, and the values here are not ours
# to constrain.
bare_run() {
	_home=$1; shift
	_env_args=""
	set -- "$@"
	# collect KEY=VAL until the -- separator, keeping each as ONE argument
	_collected=""
	while [ $# -gt 0 ]; do
		[ "$1" = "--" ] && { shift; break; }
		_collected="$_collected$1
"
		shift
	done
	# $@ is now the command; feed env -i the whitelist plus the collected pairs
	IFS='
'
	# shellcheck disable=SC2086
	set -- $_collected "$@"
	unset IFS
	env -i PATH="$PATH" HOME="$_home" LANG="${LANG:-en_US.UTF-8}" \
		TERM="${TERM:-xterm-256color}" TMPDIR="${TMPDIR:-/tmp}" "$@"
}
