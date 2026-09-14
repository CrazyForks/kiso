#!/bin/sh
# EFFORT on REAL DEVELOPMENT WORK — three task kinds, one low/high pair each.
#
# The T5 round said `low` was 27.5% cheaper over nine pairs of ONE task, and
# the review was right to call that a repeated sample rather than nine kinds
# of work. This round asks the question Astra set: on naturally-shaped
# development tasks, with search and scripting allowed, does the cheaper
# level still do the job.
#
#   devA  a cross-file change     — one option threaded through four modules
#   devB  fault localization      — a symptom three files from its cause
#   devC  a constrained refactor  — deduplicate with NO behaviour change
#
# ACCEPTANCE IS WRITTEN FIRST and lives outside the fixture (bench/accept-*),
# copied in at verify time. The agent never sees it and cannot edit it. Each
# one was checked BOTH WAYS before this round was frozen: it fails on the
# untouched fixture and passes on a correct solution. An acceptance nobody
# has seen fail is not known to test anything.
#
# THE ONE DIFFERENCE is the effort token on turn 1. Both arms send the same
# `/model ds <level>` line. `ds` is a named profile written into each leg's
# own KISO_HOME: a direct-write `openai-compat/...` names no baseUrl and
# effectiveBaseUrl then supplies the VENDOR DEFAULT, which would send the key
# to the wrong endpoint entirely.
#
# WHAT IS RECORDED BEYOND COST, because the review asked for it: whether the
# task was accepted, how many turns and requests it took, and the durable
# profile's bound level. Rework and human intervention have no proxy in an
# unattended leg and are NOT claimed here — this round cannot see them, and
# says so rather than reporting a blank as a zero.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
. "$B/leg-limits.sh"
. "$B/bare-env.sh"
ROUND=${KISO_ROUND:-dev-effort}
DEADLINE=${KISO_LEG_DEADLINE_S:-900}
LEG_MAX_REQUESTS=${KISO_LEG_MAX_REQUESTS:-200}
TASKS=${KISO_DEV_TASKS:-"devA devB devC"}
. "${XDG_CONFIG_HOME:-$HOME/.config}/claude-deepseek/credentials.env"

legdir() { printf '%s/runs/%s/runs/kiso-T5%s-p%s\n' "$B" "$ROUND" "$1" "$2"; }

leg() {
  arm=$1; eff=$2; task=$3
  W=$(legdir "$arm" "$task")
  rm -rf "$W"; mkdir -p "$W" "$W/ext" "$W/skills" "$W/kiso-home"
  cp -R "$B/fixture-$task/" "$W/repo/"; rm -rf "$W/repo/.git"
  cp "$B/bench-allow.mjs" "$W/ext/"
  cat > "$W/kiso-home/config.json" <<CFG
{ "models": { "ds": { "kind": "openai-compat", "model": "deepseek-v4-flash",
  "baseUrl": "https://api.deepseek.com", "apiKeyEnv": "OPENAI_API_KEY" } } }
CFG
  WBARE=$(bare_home "$W")
  printf '%s\n' "$eff" > "$W/effort"
  NT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-$task.json','utf8')).length)")
  : > "$W/turns.txt"
  printf '/model ds %s\n' "$eff" >> "$W/turns.txt"
  i=1; while [ "$i" -le "$NT" ]; do
    node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-$task.json','utf8'))[$i-1])" >> "$W/turns.txt"
    i=$((i + 1))
  done
  lines=$(wc -l < "$W/turns.txt" | tr -d " ")
  [ "$lines" -eq $((NT + 1)) ] || { echo "REFUSED: turns.txt has $lines lines for $((NT + 1)) inputs" >&2; exit 4; }

  S=$(date +%s)
  set +e
  ( cd "$W/repo" && bare_bounded "$WBARE" "$DEADLINE" "$W/stdout.log" \
      "OPENAI_BASE_URL=https://api.deepseek.com" "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
      "OPENAI_MODEL=deepseek-v4-flash" "KISO_EXTENSIONS_DIR=$W/ext" \
      "KISO_HOME=$W/kiso-home" "KISO_SKILLS_DIR=$W/skills" "KISO_NO_UPDATE_CHECK=1" \
      -- kiso --mode bypass "dev-$task-$arm" < "$W/turns.txt" )
  rc=$?
  set -e
  E=$(date +%s); echo "$((E-S))" > "$W/wall_seconds"; printf '%s\n' "$rc" > "$W/exit_code"

  node "$B/classify-leg.mjs" "$W" "$rc" "$NT" > "$W/classification.json"
  cls=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$W/classification.json")
  "$B/dev-verify.sh" "$W/repo" "$task" > "$W/verify"
  reqs=$(requests_so_far "$W" kiso)

  node -e '
  const fs=require("fs"),p=require("path");
  const d=process.argv[1]+"/kiso-home/sessions";
  let bound=null,revision=null;
  try{const m=fs.readdirSync(d).filter(x=>x.endsWith(".meta.json"))[0];
    const j=JSON.parse(fs.readFileSync(p.join(d,m),"utf8"));
    bound=j.profile&&j.profile.reasoning&&j.profile.reasoning.effort; revision=j.profile&&j.profile.revision;}catch{}
  fs.writeFileSync(process.argv[1]+"/effort_bound.json",JSON.stringify({bound,revision,wanted:process.argv[2]},null,1)+"\n");
  ' "$W" "$eff"
  bound=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/effort_bound.json","utf8"));console.log(j.bound===j.wanted?"ok":"MISMATCH:"+j.bound)' "$W")

  if [ "$cls" != "completed" ]; then
    mark_incomplete "$W" "$cls" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).reason)' "$W/classification.json")"
  elif [ "$reqs" -ge "$LEG_MAX_REQUESTS" ]; then
    mark_incomplete "$W" requests "the leg reached $reqs requests (ceiling $LEG_MAX_REQUESTS)"
  else
    mark_complete "$W"
  fi

  OBSERVED_MODEL=$(node "$B/observed-model.mjs" "$W" kiso 2>/dev/null || echo "")
  export OBSERVED_MODEL
  node --input-type=module -e "
  import { captureArm } from '$B/capture-config.mjs';
  import { writeFileSync } from 'node:fs';
  const observed = {};
  if (process.env.OBSERVED_MODEL) observed.model = process.env.OBSERVED_MODEL;
  const cfg = captureArm({ tool: 'kiso', command: ['kiso'], model: 'deepseek-v4-flash',
    endpoint: 'https://api.deepseek.com', envNames: ['OPENAI_API_KEY'],
    reasoning: { effort: '$eff' }, observed });
  cfg.task = '$task'; cfg.run = '$task'; cfg.arm = '$arm'; cfg.effort = '$eff';
  cfg.round = process.env.KISO_ROUND || null;
  cfg.legDeadlineSeconds = $DEADLINE; cfg.legMaxRequests = $LEG_MAX_REQUESTS;
  writeFileSync('$W/config.json', JSON.stringify(cfg, null, 1) + '\n');
  " 2>/dev/null || echo "WARN: configuration capture failed for $arm-$task" >&2

  echo "$task $arm effort=$eff wall=$((E-S))s ending=$cls verify=$(cat "$W/verify") requests=$reqs bound=$bound"
  if [ "$cls" = "vendor_interrupted" ]; then
    echo "STOP — the provider refused this leg. Nothing further runs; the record and the spend stay." >&2
    exit 5
  fi
}

n=1
for task in $TASKS; do
  # alternate which arm leads, so order is never confounded with arm
  if [ $((n % 2)) -eq 1 ]; then leg low low "$task"; leg high high "$task"
  else leg high high "$task"; leg low low "$task"; fi
  n=$((n + 1))
done
echo "--- rows: python3 $B/extract-t5.py $B/runs/$ROUND ---"
