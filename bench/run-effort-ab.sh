#!/bin/sh
# EFFORT A/B: does a lower reasoning level do the same work for less?
#
# WHY THIS AND NOT THE THRESHOLD. Two read-only surveys of 78 real sessions
# and their 715 recorded requests, in bench/survey-projected.mjs and
# bench/cost-anatomy.mjs:
#   - the compaction threshold has NEVER fired in real use. 0 of 78 sessions
#     reached 100,000; the highest ever was 53,475. Tuning it tunes a knob
#     nothing in observed usage reaches.
#   - output is 56.4% of cost_equivalent, and 86.4% of generated CHARACTERS
#     are thinking rather than visible text. (A character proxy, and named as
#     one: canonical.reasoning is null on all 715 requests.)
#   - not one of those 715 requests carried a reasoning field. Every real
#     session ran the provider default, which the registry gives as `high`
#     for deepseek-v4-flash out of low/high/max.
# So the field that touches the majority of the bill has never been set and
# never been measured. That is this round's variable.
#
# THE ONE DIFFERENCE is the effort token on turn 1. BOTH arms send the same
# `/model ds <effort>` line, so the switch itself is not a difference between
# them — only the level is.
#
# WHY A NAMED PROFILE AND NOT `/model openai-compat/deepseek-v4-flash`.
# directWriteProfile names no baseUrl, and effectiveBaseUrl then supplies the
# VENDOR DEFAULT — api.openai.com. A direct-write switch would send the
# DeepSeek key to OpenAI, which is the boundary Astra's F1 made explicit. The
# profile is written into each leg's own KISO_HOME so the endpoint rides with
# the switch.
#
# The task is the existing T5 long-session fixture: a real mid-length
# development job with mechanical acceptance (its own tests must pass),
# where search and scripting are allowed — the normal-work regime, not the
# forced-transcription probe, which is retired.
set -eu
B="$(cd "$(dirname "$0")" && pwd)"
. "$B/leg-limits.sh"
. "$B/bare-env.sh"
ROUND=${KISO_ROUND:-effort-ab}
DEADLINE=${KISO_LEG_DEADLINE_S:-900}
HIGH=${KISO_AB_HIGH:-high}      # the provider default every real session ran
LOW=${KISO_AB_LOW:-low}         # the untested level
PAIRS_N=${KISO_AB_PAIRS:-10}
FROM=${KISO_AB_FROM:-1}
LEG_MAX_REQUESTS=${KISO_LEG_MAX_REQUESTS:-200}
. "${XDG_CONFIG_HOME:-$HOME/.config}/claude-deepseek/credentials.env"
NTURNS=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-t5.json','utf8')).length)")
TURN() { node -e "console.log(JSON.parse(require('fs').readFileSync('$B/tasks-t5.json','utf8'))[$1-1])"; }

legdir() { printf '%s/runs/%s/runs/kiso-T5%s-p%s\n' "$B" "$ROUND" "$1" "$2"; }

leg() {
  arm=$1; eff=$2; pair=$3
  W=$(legdir "$arm" "$pair")
  rm -rf "$W"; mkdir -p "$W"
  cp -R "$B/fixture-t5/" "$W/repo/"; rm -rf "$W/repo/.git"
  mkdir -p "$W/ext" "$W/skills" "$W/kiso-home"; cp "$B/bench-allow.mjs" "$W/ext/"
  # The named profile that keeps the endpoint across the switch.
  cat > "$W/kiso-home/config.json" <<CFG
{ "models": { "ds": { "kind": "openai-compat", "model": "deepseek-v4-flash",
  "baseUrl": "https://api.deepseek.com", "apiKeyEnv": "OPENAI_API_KEY" } } }
CFG
  WBARE=$(bare_home "$W")
  printf '%s\n' "$eff" > "$W/effort"

  # Turn 1 sets the level; the task turns follow. Lines in, turns out.
  : > "$W/turns.txt"
  printf '/model ds %s\n' "$eff" >> "$W/turns.txt"
  i=1; while [ "$i" -le "$NTURNS" ]; do TURN "$i" >> "$W/turns.txt"; i=$((i + 1)); done
  lines=$(wc -l < "$W/turns.txt" | tr -d " ")
  if [ "$lines" -ne $((NTURNS + 1)) ]; then
    echo "REFUSED: turns.txt has $lines lines for $((NTURNS + 1)) inputs" >&2; exit 4
  fi

  S=$(date +%s)
  set +e
  ( cd "$W/repo" && bare_bounded "$WBARE" "$DEADLINE" "$W/stdout.log" \
      "OPENAI_BASE_URL=https://api.deepseek.com" \
      "OPENAI_API_KEY=$DEEPSEEK_API_KEY" \
      "OPENAI_MODEL=deepseek-v4-flash" \
      "KISO_EXTENSIONS_DIR=$W/ext" \
      "KISO_HOME=$W/kiso-home" \
      "KISO_SKILLS_DIR=$W/skills" \
      "KISO_NO_UPDATE_CHECK=1" \
      -- kiso --mode bypass "eff-$arm-$pair" < "$W/turns.txt" )
  rc=$?
  set -e
  E=$(date +%s)
  echo "$((E-S))" > "$W/wall_seconds"
  printf '%s\n' "$rc" > "$W/exit_code"

  node "$B/classify-leg.mjs" "$W" "$rc" $((NTURNS + 1)) > "$W/classification.json"
  cls=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)' "$W/classification.json")
  "$B/t5-verify.sh" "$W/repo" > "$W/verify"
  reqs=$(requests_so_far "$W" kiso)

  # THE EFFORT MUST BE ON THE WIRE, not merely typed. A leg whose switch was
  # refused would run the default and be scored as the other arm.
  node -e '
  const fs=require("fs"),p=require("path");
  const d=process.argv[1]+"/kiso-home/sessions/traces";
  let withEffort=0,total=0,levels={};
  try{for(const f of fs.readdirSync(d)){
    for(const l of fs.readFileSync(p.join(d,f),"utf8").split("\n")){
      if(!l.trim())continue; let e; try{e=JSON.parse(l)}catch{continue}
      if(e.kind!=="request")continue; total++;
      const lv=e.reasoning&&e.reasoning.effort;
      if(lv!==undefined&&lv!==null){withEffort++;levels[lv]=(levels[lv]||0)+1;}
    }}}catch{}
  fs.writeFileSync(process.argv[1]+"/effort_on_wire.json",
    JSON.stringify({requests:total,withEffort,levels},null,1)+"\n");
  ' "$W"
  onwire=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/effort_on_wire.json","utf8"));console.log(j.withEffort+"/"+j.requests+" "+JSON.stringify(j.levels))' "$W")

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
  cfg.task = 'T5'; cfg.run = '$pair'; cfg.arm = '$arm'; cfg.round = process.env.KISO_ROUND || null;
  cfg.effort = '$eff';
  cfg.legDeadlineSeconds = $DEADLINE; cfg.legMaxRequests = $LEG_MAX_REQUESTS;
  writeFileSync('$W/config.json', JSON.stringify(cfg, null, 1) + '\n');
  " 2>/dev/null || echo "WARN: configuration capture failed for $arm-$pair" >&2

  echo "$arm pair=$pair effort=$eff wall=$((E-S))s ending=$cls verify=$(cat "$W/verify") requests=$reqs effort_on_wire=$onwire"

  if [ "$cls" = "vendor_interrupted" ]; then
    echo "STOP — the provider refused this leg. Nothing further runs; the record and the spend stay." >&2
    exit 5
  fi
}

p=$FROM
while [ "$p" -le "$PAIRS_N" ]; do
  if [ $((p % 2)) -eq 1 ]; then
    leg low "$LOW" "$p"; leg high "$HIGH" "$p"
  else
    leg high "$HIGH" "$p"; leg low "$LOW" "$p"
  fi
  if [ "$p" -eq "$FROM" ]; then
    lo=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.withEffort)' "$(legdir low "$p")/effort_on_wire.json")
    hi=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(j.withEffort)' "$(legdir high "$p")/effort_on_wire.json")
    echo "resolution check: requests carrying an effort field — low=$lo high=$hi"
    if [ "$lo" -lt 1 ] || [ "$hi" -lt 1 ]; then
      echo "STOP — the effort never reached the wire. Both arms ran the provider default." >&2
      exit 3
    fi
  fi
  p=$((p + 1))
done
echo "--- extract with: python3 $B/extract-t5.py $B/runs/$ROUND ---"
