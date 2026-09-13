#!/bin/sh
# run-t5.sh <tool: kiso|pi|claude> <run-id>
# The long-session scenario: 8 progressive turns on fixture-t5, then the
# final verify. Each tool drives the session with its NATIVE mechanism:
#   kiso   — 3 processes on one durable session: turns 1-5, then the
#            /compact line (the round's subject — the mid-way model
#            summary), then turns 6-8. The session log is the durable
#            thread; EOF ends each process.
#   pi     — 8 `-p` invocations sharing one --session file (its native
#            session continuation).
#   claude — 8 `-p` invocations sharing one --resume session (its native;
#            CC auto-compacts on its own threshold if it ever fires).
# Wall = the sum of the per-process seconds. Usage is extracted per tool
# from its own records by extract-t5.py.
set -eu
TOOL=$1; RUN=$2
B="$(cd "$(dirname "$0")" && pwd)"
# KISO_BIN overrides the kiso command (band A/B runs against a pinned
# published bin: KISO_BIN="npx -y @vincemakes/kiso-code@0.2.1"). KISO_VERSION
# names that bin in meta.json.
#
# THE DEFAULT ASKS THE BINARY THAT WILL RUN, NOT THE CHECKOUT AROUND IT.
# It used to read the local apps/cli/package.json unconditionally, so handing
# this script a pinned published bin recorded the HOST's version in
# meta.json — an arm labelled with a version it never executed, which is the
# one field a comparison between arms cannot afford to have wrong. The
# historical caveat on runs recorded before this change stands; the records
# are not rewritten.
KISO_BIN=${KISO_BIN:-kiso}
# Only the kiso arm needs a kiso version, and only when one was not given.
# Probing unconditionally made every OTHER agent's run require kiso to be
# installed — a bench runner that cannot measure a competitor without our
# own binary present is a broken runner (Astra, PR #32).
if [ "$TOOL" = "kiso" ] && [ -z "${KISO_VERSION:-}" ]; then
  # `$KISO_BIN --version` unquoted on purpose: KISO_BIN may be a COMMAND with
  # arguments ("npx -y @vincemakes/kiso-code@0.2.1"), not a single path.
  # The EXIT STATUS is kept: a bin that fails while printing to stdout used to
  # have its error message recorded as the version — "error: unknown flag
  # --version" went into meta.json as if it were 0.34.0.
  if PROBE=$($KISO_BIN --version 2>/dev/null); then
    KISO_VERSION=$(printf '%s' "$PROBE" | tr -d '\r' | tail -1)
  else
    KISO_VERSION=""
  fi
  # And it must LOOK like a version. Anything else is a bin that answered
  # something other than the question.
  case "$KISO_VERSION" in
    [0-9]*.[0-9]*.[0-9]*) : ;;
    *) KISO_VERSION="" ;;
  esac
  if [ -z "$KISO_VERSION" ]; then
    echo "FAIL: KISO_BIN ($KISO_BIN) did not report a version." >&2
    echo "      A run labelled with the WRONG version is worse than no run —" >&2
    echo "      an arm's version is the one field a comparison cannot afford" >&2
    echo "      to have wrong. Set KISO_VERSION explicitly if this bin cannot" >&2
    echo "      report one." >&2
    exit 1
  fi
fi
# E4-e: KISO_ROUND scopes the runs under runs/<round>/ (the run-hygiene
# discipline — a round never reuses a historical run name); absent = the
# historical flat layout.
WORK="$B/runs/${KISO_ROUND:+$KISO_ROUND/}$TOOL-T5-$RUN"
rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$B/fixture-t5/" "$WORK/repo/"
rm -rf "$WORK/repo/.git"
. "${XDG_CONFIG_HOME:-$HOME/.config}/claude-deepseek/credentials.env"
TOT=0
# PER-LEG HARD LIMITS. A leg had none: a hung arm ran until someone noticed,
# a looping arm spent the programme's budget on one task. Overridable, but
# never absent.
. "$B/leg-limits.sh"
. "$B/bare-env.sh"
BARE_HOME=$(bare_home "$WORK")
LEG_DEADLINE_S=${KISO_LEG_DEADLINE_S:-1800}
LEG_MAX_REQUESTS=${KISO_LEG_MAX_REQUESTS:-200}
LEG_STARTED=$(date +%s)
LEG_STOPPED=""

# Remaining wall budget for the next segment, or empty when it is spent.
remaining() {
	_used=$(( $(date +%s) - LEG_STARTED ))
	_left=$(( LEG_DEADLINE_S - _used ))
	[ "$_left" -gt 0 ] && echo "$_left" || echo ""
}

# Stop between segments when a bound is reached. Marks the leg INCOMPLETE
# with its reason — never `fail`: a product that would have finished in one
# more minute did not fail the task, it hit OUR limit.
over_budget() {
	_left=$(remaining)
	if [ -z "$_left" ]; then
		mark_incomplete "$WORK" deadline "the leg's ${LEG_DEADLINE_S}s wall budget was spent"
		LEG_STOPPED=deadline; return 0
	fi
	_reqs=$(requests_so_far "$WORK" "$TOOL")
	if [ "$_reqs" -ge "$LEG_MAX_REQUESTS" ]; then
		mark_incomplete "$WORK" requests "the leg reached $_reqs requests (ceiling $LEG_MAX_REQUESTS)"
		LEG_STOPPED=requests; return 0
	fi
	return 1
}

cd "$WORK/repo"
TURN() { node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-t5.json','utf8'))[$1-1])"; }

case "$TOOL" in
  kiso)
    EXTDIR="$WORK/ext"; mkdir -p "$EXTDIR"; cp "$B/bench-allow.mjs" "$EXTDIR/"
    SKILLDIR="$WORK/skills"; mkdir -p "$SKILLDIR"
    assert_bare kiso "$BARE_HOME" || exit 1
    # §3: KISO_SKILLS_DIR was missing entirely — an arm reading the operator's
    # skills is not the product as installed.
    # §3: KISO_SKILLS_DIR was missing entirely — an arm reading the
    # operator's skills is not the product as installed.
    set -- "OPENAI_BASE_URL=https://api.deepseek.com" "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
      "OPENAI_MODEL=deepseek-v4-flash" "KISO_EXTENSIONS_DIR=$EXTDIR" \
      "KISO_HOME=$WORK/kiso-home" "KISO_SKILLS_DIR=$SKILLDIR" "KISO_NO_UPDATE_CHECK=1"
    KISO_ENV_PAIRS="$*"
    seg() { # seg <n> <stdin-producer...>
      _n=$1; shift
      over_budget && return 0
      _left=$(remaining)
      S=$(date +%s)
      # shellcheck disable=SC2086
      "$@" | bare_bounded "$BARE_HOME" "$_left" "$WORK/stdout-$_n.log" \
        $KISO_ENV_PAIRS -- $KISO_BIN --mode bypass "bench-t5-$TOOL-$RUN" || true
      E=$(date +%s); TOT=$((TOT + E - S))
    }
    seg 1 printf '%s\n' "$(TURN 1)" "$(TURN 2)" "$(TURN 3)" "$(TURN 4)" "$(TURN 5)"
    seg 2 printf '/compact\n'
    seg 3 printf '%s\n' "$(TURN 6)" "$(TURN 7)" "$(TURN 8)"
    node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const meta = {
  tool: 'kiso', task: 'T5', run: '$RUN', round: process.env.KISO_ROUND || null,
  model: 'deepseek-v4-flash',
  kisoVersion: '$KISO_VERSION',
  commit: execSync('git -C $B/.. rev-parse --short HEAD').toString().trim(),
  createdAt: Date.now(),
};
fs.writeFileSync('$WORK/meta.json', JSON.stringify(meta, null, 1) + '\n');
"
    ;;
  pi)
    assert_bare pi "$BARE_HOME" || exit 1
    for i in 1 2 3 4 5 6 7 8; do
      over_budget && break
      S=$(date +%s)
      bare_bounded "$BARE_HOME" "$(remaining)" "$WORK/stdout-$i.log" \
        "DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY" -- \
        pi --provider deepseek --model deepseek-v4-flash -p --mode json \
        --session "$WORK/pi-session" "$(TURN $i)" < /dev/null || true
      E=$(date +%s); TOT=$((TOT + E - S))
    done
    ;;
  claude)
    assert_bare claude "$BARE_HOME" || exit 1
    CCFG="$WORK/claude-config"; mkdir -p "$CCFG"
    # §3: a fresh HOME and CLAUDE_CONFIG_DIR. Without them the arm read the
    # operator's ~/.claude.json and authenticated with THEIR account key —
    # eight 401s recorded as a task failure.
    set -- "CLAUDE_CONFIG_DIR=$CCFG" \
      "ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic" \
      "ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY" \
      "ANTHROPIC_MODEL=deepseek-v4-flash" \
      "ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-flash" \
      "ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash"
    CLAUDE_ENV_PAIRS="$*"
    SID=""
    for i in 1 2 3 4 5 6 7 8; do
      over_budget && break
      S=$(date +%s)
      if [ -z "$SID" ]; then
        bare_bounded "$BARE_HOME" "$(remaining)" "$WORK/stdout-$i.log" \
          $CLAUDE_ENV_PAIRS -- \
          claude -p "$(TURN $i)" --output-format json --strict-mcp-config --mcp-config '{"mcpServers":{}}' --dangerously-skip-permissions < /dev/null || true
        # PARSE PER LINE. Claude Code prints warnings around its result JSON
        # — `[claude-code:unrecognized_model] {...}` is line one here — so
        # `json.load(whole file)` throws and SID stayed empty. Every turn then
        # started a NEW session: eight turns, eight session ids, each
        # re-sending the whole context. Read as a product result that is
        # "Claude Code is 6.8x more expensive on a long session", when no long
        # session ever existed.
        #
        # extract.py already parses per line for exactly this reason. The fix
        # was made there and not here, and nobody asked the sibling.
        SID=$(python3 -c "
import json,sys
for line in open('$WORK/stdout-$i.log', errors='ignore'):
    t=line.strip()
    if not t.startswith('{'): continue
    try: o=json.loads(t)
    except Exception: continue
    if isinstance(o,dict) and o.get('session_id'):
        print(o['session_id']); break
" 2>/dev/null || true)
        [ -n "$SID" ] || echo "WARN: no session_id in turn $i — the next turn cannot resume" >&2
      else
        bare_bounded "$BARE_HOME" "$(remaining)" "$WORK/stdout-$i.log" \
          $CLAUDE_ENV_PAIRS -- \
          claude -p "$(TURN $i)" --resume "$SID" --output-format json --strict-mcp-config --mcp-config '{"mcpServers":{}}' --dangerously-skip-permissions < /dev/null || true
      fi
      E=$(date +%s); TOT=$((TOT + E - S))
    done
    ;;
esac
echo "$TOT" > "$WORK/wall_seconds"

# ── the per-arm configuration manifest (§10.3, amendment 4b) ────────────
#
# Written for ALL THREE arms. Before this only kiso got a meta.json, and it
# carried `model: 'deepseek-v4-flash'` as a hardcoded string — a
# SPECIFICATION presented as a MEASUREMENT — plus a `commit` read from the
# host checkout, which is the same defect as the version field: hand the
# runner a pinned published bin and the record names a commit it was never
# built from.
#
# Specified and observed are kept apart. The served model id is read back
# from what the run actually produced; when it cannot be seen, the field is
# null with a reason rather than the specification copied over.
case "$TOOL" in
  kiso)   ARM_CMD="$KISO_BIN"; ARM_MODEL="deepseek-v4-flash"; ARM_ENDPOINT="https://api.deepseek.com"; ARM_ENV="OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL KISO_HOME KISO_EXTENSIONS_DIR" ;;
  pi)     ARM_CMD="pi";        ARM_MODEL="deepseek-v4-flash"; ARM_ENDPOINT="https://api.deepseek.com"; ARM_ENV="DEEPSEEK_API_KEY" ;;
  claude) ARM_CMD="claude";    ARM_MODEL="deepseek-v4-flash"; ARM_ENDPOINT="https://api.deepseek.com/anthropic"; ARM_ENV="ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL" ;;
esac
OBSERVED_MODEL=$(node "$B/observed-model.mjs" "$WORK" "$TOOL" 2>/dev/null || echo "")
export OBSERVED_MODEL
node --input-type=module -e "
import { captureArm } from '$B/capture-config.mjs';
import { writeFileSync } from 'node:fs';
const observed = {};
const m = process.env.OBSERVED_MODEL;
if (m) observed.model = m;
const cfg = captureArm({
  tool: '$TOOL',
  command: '$ARM_CMD'.split(' ').filter(Boolean),
  model: '$ARM_MODEL',
  endpoint: '$ARM_ENDPOINT',
  envNames: '$ARM_ENV'.split(' ').filter(Boolean),
  observed,
});
cfg.task = 'T5'; cfg.run = '$RUN'; cfg.round = process.env.KISO_ROUND || null;
cfg.legDeadlineSeconds = $LEG_DEADLINE_S; cfg.legMaxRequests = $LEG_MAX_REQUESTS;
writeFileSync('$WORK/config.json', JSON.stringify(cfg, null, 1) + '\n');
" 2>/dev/null || echo "WARN: configuration capture failed for $TOOL" >&2
[ -f "$WORK/status" ] || mark_complete "$WORK"
VERIFY=$("$B/t5-verify.sh" "$WORK/repo")
echo "$VERIFY" > "$WORK/verify"
echo "DONE T5 $TOOL run=$RUN wall=${TOT}s verify=$VERIFY"
