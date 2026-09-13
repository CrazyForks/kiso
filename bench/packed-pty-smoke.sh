#!/bin/sh
# packed-pty-smoke.sh [<tgz-or-version>]
# The release ceremony's "packed PTY smoke": an interactive PTY session on
# the PACKED cli artifact (never the published one — publish is a HOLD'd
# action; the E2-round shape). Assertions, all on the PTY capture:
#   1. the banner reads the expected version (v0.4.0 by default),
#   2. the built-ins render (the /help list — the E5 banner's 8 columns),
#   3. the session exits cleanly.
# The environment: a FRESH KISO_HOME (the E2 lesson — never reuse), the
# installed bin from the packed tarball.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
# R4 (the 0.18.0 ceremony): the default was the literal "v0.4.0", stale
# since the round that wrote it AND wrong in a second way — the banner
# renders `kiso <version>` with no "v", and with an SGR reset between the
# name and the number, so neither "v0.18.0" nor "kiso 0.18.0" is a
# contiguous needle in the raw capture. It read as a release-blocking
# FAIL twice before the cause was the script. The default is now the
# workspace's own version, and the grep runs on the SGR-stripped capture.
VERSION=${EXPECTED_BANNER:-$(node -p "require('$(cd "$(dirname "$0")/.." && pwd)/package.json').version")}
SRC=${1:-}
TMP=$(mktemp -d /tmp/e6-pty.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

if [ -n "$SRC" ]; then
  # an explicit tarball (or a published name) — install it
  mkdir -p "$TMP/proj"; cd "$TMP/proj"
  npm init -y > /dev/null 2>&1
  npm install --no-audit --no-fund "$SRC" > /dev/null 2>&1
  BIN="$TMP/proj/node_modules/.bin/kiso"
else
  # Pack the WHOLE closure — all fourteen — in dependency order.
  #
  # This used to pack only the cli and the runtime, on the reasoning that
  # "the other eleven pins are the published line and come from the
  # registry". That stopped being true when releases went lockstep: every
  # pin now names the NEW version, which is not on the registry while
  # publish is still ahead of us, so the install died with
  # `notarget @vincemakes/kiso-ask-ext@<new>` — silently, because the
  # installs are redirected to /dev/null, leaving a missing BIN and an
  # exit with no output. Caught at the 0.15.2 ceremony.
  #
  # scripts/smoke.mjs already nests the full closure for its tier D.
  # REL-0340-F1: DERIVED, never named. This was a hand-written list of 14
  # names beside a workspace of 15 publishable packages; the one it omitted
  # was kiso-provider-openai-responses, missing for four releases including
  # the one that changed that package. A list a human maintains beside a set
  # a build produces drifts, and it drifts SILENTLY — the script passed the
  # whole time, having nested one package fewer than the release ships.
  #
  # An ARGV array inside node, not a shell string: `git ls-files
  # *package.json` goes through /bin/sh, which expands the glob against the
  # cwd and matches the root manifest alone, and the closure comes back
  # EMPTY. An empty closure is a FAILED READ, not a true answer — which is
  # why the count is asserted below before anything is packed.
  PKGS=$("$B/../scripts/publishable-packages.mjs")
  PKG_N=$(echo "$PKGS" | tr ' ' '\n' | grep -c .)
  # A derivation that finds nothing is a FAILED READ, not an empty workspace.
  [ "$PKG_N" -ge 2 ] || { echo "FAIL: derived $PKG_N publishable packages — a failed read"; exit 1; }
  echo "derived closure: $PKG_N packages"
  PACKED=""
  for pkg in $PKGS; do
    TGZ_ONE=$(npm pack -w "$pkg" --pack-destination "$TMP" 2>/dev/null | tail -1)
    [ -n "$TGZ_ONE" ] && [ -f "$TMP/$TGZ_ONE" ] || { echo "FAIL pack: $pkg"; exit 1; }
    PACKED="$PACKED $TMP/$TGZ_ONE"
  done
  PACKED_N=$(echo "$PACKED" | tr ' ' '\n' | grep -c '\.tgz$')
  [ "$PACKED_N" = "$PKG_N" ] || { echo "FAIL: packed $PACKED_N tarballs for $PKG_N packages"; exit 1; }
  mkdir -p "$TMP/proj"; cd "$TMP/proj"
  npm init -y > /dev/null 2>&1
  # ONE install over the whole set, never one at a time. The derived order is
  # the repo's, not a dependency order — the cli sorts first and depends on
  # all fourteen others — and a lockstep release's pins are NOT on the
  # registry while the publish is still ahead of us, so installing them
  # individually asks npm for a version that does not exist yet. Installed
  # together, every pin resolves from the set itself. This passed only
  # because 0.36.0 happens to be published; it would have failed at the next
  # ceremony, which is the one moment this script matters.
  # shellcheck disable=SC2086
  npm install --install-strategy=nested --no-audit --no-fund --no-package-lock $PACKED > "$TMP/install.log" 2>&1 \
    || { echo "FAIL install: the $PACKED_N-package closure"; tail -12 "$TMP/install.log"; exit 1; }
  BIN="$TMP/proj/node_modules/.bin/kiso"
  [ -x "$BIN" ] || { echo "FAIL: no kiso bin after installing the closure"; exit 1; }
fi

export KISO_HOME="$TMP/home"
# macOS ships no `timeout` — the perl-alarm wrapper is the standard
# substitute: a hung chat dies to SIGALRM (rc 142) and FAILs the smoke.
# CR, not LF: the multiline composer submits on \r; \n only inserts a
# line break (the KC1 driver supersession — this harness was the one
# file the 31-file \n→\r sweep missed, caught at the 0.13.0 ceremony).
# The sleeps pace input past TUI mount so submissions hit a wired
# dispatcher, and settle each command before the next.
(sleep 2; printf '/help\r'; sleep 3; printf 'exit\r'; sleep 5) \
  | perl -e 'alarm 120; exec @ARGV' script -q "$TMP/capture" "$BIN" chat > /dev/null 2>&1
RC=$?
CAP="$TMP/capture"
CAP_PLAIN="$TMP/capture.plain"
perl -pe 's/\e\[[0-9;?]*[A-Za-z]//g' "$CAP" > "$CAP_PLAIN"
grep -q "$VERSION" "$CAP_PLAIN" && echo "PASS banner: $VERSION" || { echo "FAIL banner: expected $VERSION"; exit 1; }
# /compact is asserted (not "help"): the typed "/help" echoes into the
# capture, so only a command NEVER typed proves the help list rendered.
grep -q "/compact" "$CAP" && echo "PASS built-ins render" || { echo "FAIL built-ins"; exit 1; }
[ "$RC" -eq 0 ] && echo "PASS clean exit (rc=0, capture tail: $(tail -1 "$CAP" | tr -d '\r' | cut -c1-40))" \
  || { echo "FAIL clean exit: rc=$RC"; exit 1; }

# ── RD1B-F9 regression: two launches are two sessions ────────────────
# Two launches with NO explicit id, into the SAME fresh KISO_HOME, must
# not share a durable log. Each types a prompt, because a run-less
# session never appends (bare `exit` and `/help` create no log at all —
# the store's lock and jsonl are acquired lazily, by design). An earlier
# draft of this gate asserted on two `exit`-only launches and would have
# passed on a broken build by finding zero logs on both sides.
#
# This gate exists because neither smoke could see F9: the run above
# launches once, and scripts/smoke.mjs uses an explicit id (`cli-smoke`),
# so the generator was never exercised twice. The defect shipped through
# both.
#
# It runs against the PACKED artifact deliberately — an id change is
# exactly the class of thing a local dist can get right and a published
# tarball wrong, and this round already paid once for trusting a local
# build (the RD-1B evidence-tier gap).
for n in 1 2; do
  (sleep 2; printf 'hello\r'; sleep 4; printf 'exit\r'; sleep 3) \
    | perl -e 'alarm 120; exec @ARGV' script -q "$TMP/f9-$n" "$BIN" chat > /dev/null 2>&1
done
LOGS=$(find "$KISO_HOME/sessions" -maxdepth 1 -name '*.jsonl' | wc -l | tr -d ' ')
[ "$LOGS" -ge 2 ] \
  && echo "PASS session identity: $LOGS distinct durable logs from 2 launches" \
  || { echo "FAIL session identity (RD1B-F9): 2 launches produced $LOGS durable log(s) — a run-less launch logs nothing, so 0 here means the gate did not observe; 1 means the second inherited the first's history"; exit 1; }
