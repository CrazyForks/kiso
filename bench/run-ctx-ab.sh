#!/bin/sh
# CTX-1 diagnostic at the PRODUCT'S REAL VALUES: 100,000 against 500,000.
#
# The scaled pilot (bench/run-threshold-ab.sh) showed the cost side and said
# so: compacting at roughly a third of a task's peak cost a median +29.6%
# cost_equivalent across three same-signed pairs and bought no correctness.
# It could not see the BENEFIT side, because compaction only pays when the
# context would otherwise overflow, and the T5 fixture peaks near 10,000
# tokens — a ninth of the way to the threshold.
#
# This fixture exists to enter that regime. src/ is a pinned snapshot of 26
# real TypeScript files, 673,822 characters, roughly 168,000 tokens once
# read. The 100,000 arm therefore compacts partway through and must recover
# the early entries for the final turn; the 500,000 arm never compacts and
# carries the whole tree.
#
# The corpus is the TUI packages, NOT the kernel. The kernel's sources
# discuss microcompaction by name, and a fixture that describes the
# mechanism under test to the agent being tested is a confound worth one
# `cp` to avoid. The exact JSON needle the boundary counter greps for never
# appeared in either corpus, so the counter was never at risk; the agent's
# reading was.
#
# WHY THE TASK FORBIDS SCRIPTING. The scored answer is (file, name, start
# line, END line). A start line is greppable; the closing brace is not near
# the signature, and every entry also needs a one-sentence purpose that only
# reading produces. A fixture an agent can answer without filling its context
# cannot test a context policy. Both arms get the same instruction, so the
# constraint is the task, not a difference between arms.
#
# THE ONE DIFFERENCE remains KISO_POLICY_MICROCOMPACT. KISO_CONTEXT_WINDOW is
# still not used: it also arms auto-summary, a second variable.
#
# Pair 1 is again a RESOLUTION CHECK — 100k must write at least one boundary
# and 500k none — and the run stops before spending on pairs 2 and 3 if the
# arms did not separate.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
. "$B/leg-limits.sh"
. "$B/bare-env.sh"
ROUND=${KISO_ROUND:-ctx-ab}
DEADLINE=${KISO_LEG_DEADLINE_S:-2400}
EARLY=${KISO_AB_EARLY:-100000}   # the product's value on an unregistered window
LATE=${KISO_AB_LATE:-500000}     # the value a 1M-window model would carry
PAIRS_N=${KISO_AB_PAIRS:-3}
FROM=${KISO_AB_FROM:-1}
# The caps leg-limits.sh already provides. The first version of this runner
# imported that file and enforced none of them: no request ceiling, no
# configuration capture, and mark_complete called unconditionally. A
# diagnostic is not a reason to route around apparatus that was fixed after
# it cost something.
LEG_MAX_REQUESTS=${KISO_LEG_MAX_REQUESTS:-200}
. "${XDG_CONFIG_HOME:-$HOME/.config}/claude-deepseek/credentials.env"
NTURNS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-ctx.json','utf8')).length)")
TURN() { node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-ctx.json','utf8'))[$1-1])"; }

legdir() { printf '%s/runs/%s/runs/kiso-T5%s-p%s\n' "$B" "$ROUND" "$1" "$2"; }
boundaries_of() { cat "$(legdir "$1" "$2")/kiso-home/sessions/"*.jsonl 2>/dev/null |
  grep -c '"type":"microcompacted"' || true; }

leg() {
  arm=$1; thr=$2; pair=$3
  W=$(legdir "$arm" "$pair")
  rm -rf "$W"; mkdir -p "$W"
  mkdir -p "$W/repo"; cp -R "$B/fixture-ctx/src" "$W/repo/src"
  mkdir -p "$W/ext" "$W/skills"; cp "$B/bench-allow.mjs" "$W/ext/"
  WBARE=$(bare_home "$W")
  printf '%s\n' "$thr" > "$W/threshold"
  S=$(date +%s)
  i=1
  : > "$W/turns.txt"
  while [ "$i" -le "$NTURNS" ]; do TURN "$i" >> "$W/turns.txt"; i=$((i + 1)); done
  # THE GATE. The CLI reads ONE LINE as ONE INPUT. The first attempt at this
  # fixture put the file list on its own lines inside a turn, so eight turns
  # went in as sixty-odd fragments: the agent was cut across every batch, the
  # answer file was written from shredded instructions, and the leg recorded
  # itself as a finished run that had failed verification. Lines in, turns
  # out — assert it rather than assume it.
  lines=$(wc -l < "$W/turns.txt" | tr -d " ")
  if [ "$lines" -ne "$NTURNS" ]; then
    echo "REFUSED: turns.txt has $lines lines for $NTURNS turns — a turn carries a newline" >&2
    exit 4
  fi
  set +e
  ( cd "$W/repo" && bare_bounded "$WBARE" "$DEADLINE" "$W/stdout.log" \
      "OPENAI_BASE_URL=https://api.deepseek.com" \
      "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
      "OPENAI_MODEL=deepseek-v4-flash" \
      "KISO_EXTENSIONS_DIR=$W/ext" \
      "KISO_HOME=$W/kiso-home" \
      "KISO_SKILLS_DIR=$W/skills" \
      "KISO_NO_UPDATE_CHECK=1" \
      "KISO_POLICY_MICROCOMPACT=$thr" \
      -- kiso --mode bypass "ctx-$arm-$pair" < "$W/turns.txt" )
  rc=$?
  set -e
  E=$(date +%s)
  echo "$((E-S))" > "$W/wall_seconds"
  printf '%s\n' "$rc" > "$W/exit_code"

  # WHY IT STOPPED, before WHETHER IT WAS RIGHT. A leg the provider refused
  # did not fail the task, and the tokens it spent are still spent — the
  # record has to say which of those two things happened before anything
  # compares its cost to another leg's.
  node "$B/classify-leg.mjs" "$W" "$rc" "$NTURNS" > "$W/classification.json"
  cls=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$W/classification.json")

  # The whole deliverable, with coverage and exactness kept apart.
  node "$B/ctx-verify.mjs" "$W/repo" --json > "$W/verify.json"
  node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(v.complete&&v.exact&&v.longestCorrect?"pass":"fail")' "$W/verify.json" > "$W/verify"

  reqs=$(requests_so_far "$W" kiso)
  if [ "$cls" != "completed" ]; then
    mark_incomplete "$W" "$cls" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reason)' "$W/classification.json")"
  elif [ "$reqs" -ge "$LEG_MAX_REQUESTS" ]; then
    mark_incomplete "$W" requests "the leg reached $reqs requests (ceiling $LEG_MAX_REQUESTS)"
  else
    mark_complete "$W"
  fi

  # The arm's identity, so a later reader can tell what was actually run
  # rather than what the script says it meant to run.
  OBSERVED_MODEL=$(node "$B/observed-model.mjs" "$W" kiso 2>/dev/null || echo "")
  export OBSERVED_MODEL
  node --input-type=module -e "
  import { captureArm } from '$B/capture-config.mjs';
  import { writeFileSync } from 'node:fs';
  const observed = {};
  if (process.env.OBSERVED_MODEL) observed.model = process.env.OBSERVED_MODEL;
  const cfg = captureArm({ tool: 'kiso', command: ['kiso'], model: 'deepseek-v4-flash',
    endpoint: 'https://api.deepseek.com', envNames: ['OPENAI_API_KEY','KISO_POLICY_MICROCOMPACT'], observed });
  cfg.task = 'CTX'; cfg.run = '$pair'; cfg.arm = '$arm'; cfg.round = process.env.KISO_ROUND || null;
  cfg.microcompactThreshold = $thr;
  cfg.contextWindowEnvSet = process.env.KISO_CONTEXT_WINDOW !== undefined;
  cfg.legDeadlineSeconds = $DEADLINE; cfg.legMaxRequests = $LEG_MAX_REQUESTS;
  writeFileSync('$W/config.json', JSON.stringify(cfg, null, 1) + '\n');
  " 2>/dev/null || echo "WARN: configuration capture failed for $arm-$pair" >&2

  f=$(boundaries_of "$arm" "$pair"); [ -n "$f" ] || f=0
  echo "$arm pair=$pair thr=$thr wall=$((E-S))s ending=$cls verify=$(cat "$W/verify") requests=$reqs boundaries=$f"

  # An unrecoverable provider refusal ends the ROUND, not just the leg: every
  # further leg would burn the same wall and produce the same refusal.
  if [ "$cls" = "vendor_interrupted" ]; then
    echo "STOP — the provider refused this leg. Nothing further runs; the record and the spend stay." >&2
    exit 5
  fi
}

p=$FROM
while [ "$p" -le "$PAIRS_N" ]; do
  if [ $((p % 2)) -eq 1 ]; then
    leg early "$EARLY" "$p"; leg late "$LATE" "$p"
  else
    leg late "$LATE" "$p"; leg early "$EARLY" "$p"
  fi
  if [ "$p" -eq 1 ]; then
    e=$(boundaries_of early 1); l=$(boundaries_of late 1)
    [ -n "$e" ] || e=0; [ -n "$l" ] || l=0
    echo "resolution check: early=$e boundaries, late=$l boundaries"
    if [ "$e" -lt 1 ] || [ "$l" -ne 0 ]; then
      echo "STOP — the two arms did not separate. Nothing further runs."
      exit 3
    fi
  fi
  p=$((p + 1))
done
echo "--- extract with: python3 $B/extract-t5.py $B/runs/$ROUND ---"
