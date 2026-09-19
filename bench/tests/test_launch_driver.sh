#!/bin/sh
# run-launch.sh, offline: substitute arms that send nothing. So every leg
# must come out VOID — no wire effort, nothing captured — which is exactly
# the path that has to work before money is spent; the cap must stop a
# part before its first pair; F must never be scheduled; a concealed pair
# must leave no staging directory behind. Free: no model, no credential.
set -eu
B="$(cd "$(dirname "$0")/.." && pwd)"
P=0; F=0
ok()   { printf "  ok   %s\n" "$1"; P=$((P+1)); }
bad()  { printf "  FAIL %s\n" "$1"; F=$((F+1)); }
T=$(cd "$(mktemp -d)" && pwd -P)
mkdir -p "$T/bin" "$T/cfg/claude-deepseek"
for t in kiso pi; do
	printf 'case "$1" in --version) echo 9.9.9; exit 0;; esac\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$T/bin/$t"
	chmod +x "$T/bin/$t"
done
echo 'DEEPSEEK_API_KEY=offline-not-a-key' > "$T/cfg/claude-deepseek/credentials.env"
PATH="$T/bin:$PATH"; XDG_CONFIG_HOME="$T/cfg"; KISO_BIN=kiso; KISO_VERSION=9.9.9
LAUNCH_ROOT="$T/runs"; LAUNCH_ROUND=off; KISO_LEG_MAX_REQUESTS=4
export PATH XDG_CONFIG_HOME KISO_BIN KISO_VERSION LAUNCH_ROOT LAUNCH_ROUND KISO_LEG_MAX_REQUESTS

# 1. a T5 part of two pairs: four legs, interleaved, every one VOID
LAUNCH_PART_CAP=100 sh "$B/run-launch.sh" t5 1 2 > "$T/t5.log" 2>&1 || true
L="$T/runs/off-t5/ledger.tsv"
rows=$(awk 'NR > 1' "$L" 2>/dev/null | wc -l | tr -d ' ')
[ "$rows" = 4 ] && ok "a two-pair T5 part writes four ledger rows" || bad "T5 ledger rows: $rows"
order=$(awk -F'\t' 'NR > 1 { printf "%s ", $2 }' "$L")
[ "$order" = "kiso pi pi kiso " ] && ok "pairs interleave: odd pairs kiso first, even pairs the other arm first" || bad "order: $order"
voids=$(awk -F'\t' 'NR > 1 && $7 != "-"' "$L" | wc -l | tr -d ' ')
[ "$voids" = 4 ] && ok "a leg with no wire effort is VOID, every one" || bad "void legs: $voids of 4"
grep -q "the wire shows effort" "$T/runs/off-t5/kiso-T5-p1/void" && ok "the void says why (the wire effort)" || bad "void reason: $(cat "$T/runs/off-t5/kiso-T5-p1/void" 2>/dev/null)"

# 2. the cap stops a part before its first pair, and says so
LAUNCH_PART_CAP=0 sh "$B/run-launch.sh" t6 1 1 > "$T/t6.log" 2>&1 || true
grep -q "INCOMPLETE" "$T/runs/off-t6/INCOMPLETE" 2>/dev/null && ok "a part at its cap is INCOMPLETE" || bad "no INCOMPLETE marker"
[ -z "$(ls -d "$T/runs/off-t6"/*-T6-* 2>/dev/null)" ] && ok "no leg ran past the cap" || bad "a leg ran past the cap"

# 3. concealed: F is never scheduled; the staged instance leaves nothing behind
TMP_BEFORE=$(ls -d "${TMPDIR:-/tmp}"/tmp.* 2>/dev/null | wc -l | tr -d ' ')
LAUNCH_PART_CAP=100 LAUNCH_INSTANCES="E-1 F-2" LAUNCH_SEED=424242 sh "$B/run-launch.sh" concealed 1 2 > "$T/c.log" 2>&1 || true
[ -d "$T/runs/off-concealed/kiso-E-1-p1" ] && [ -d "$T/runs/off-concealed/pi-E-1-p1" ] && ok "a concealed pair runs both arms on the instance" || bad "concealed legs missing: $(ls "$T/runs/off-concealed" 2>/dev/null | tr '\n' ' ')"
[ -z "$(ls -d "$T/runs/off-concealed"/*-F-2-* 2>/dev/null)" ] && grep -q "F is never scheduled" "$T/c.log" && ok "F is never scheduled, and the log says so" || bad "an F leg ran"
TMP_AFTER=$(ls -d "${TMPDIR:-/tmp}"/tmp.* 2>/dev/null | wc -l | tr -d ' ')
[ "$TMP_AFTER" -le "$TMP_BEFORE" ] && ok "no staging or held directory outlives the pair" || bad "a temp directory outlived the pair ($TMP_BEFORE → $TMP_AFTER)"
[ ! -e "$T/runs/off-concealed/kiso-E-1-p1/repo/../verifier" ] && ok "no verifier sat beside a leg" || bad "a verifier sat beside a leg"

echo "[launch-driver] $P ok, $F failed"
[ "$F" -eq 0 ]
