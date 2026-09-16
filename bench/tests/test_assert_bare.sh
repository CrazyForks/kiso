#!/bin/sh
# assert_bare's declared-injection rule.
#
# The capture round has to place ONE file in the other arm's home — a model
# store whose baseUrl points at the recorder. The honest way is to tell the
# bareness gate about it, never to skip the gate.
#
# The first version returned as soon as a declaration mentioned the
# directory, so a home carrying the declared file AND anything else beside
# it passed, while the comment above it claimed otherwise. The fourth case
# here is that gap: it is the one worth catching in one's own work first.
set -u
. "$(cd "$(dirname "$0")/.." && pwd)/bare-env.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; F=0
note() { printf '  %-4s %s\n' "$1" "$2"; [ "$1" = RED ] && F=1; return 0; }

H="$T/bare"; mkdir -p "$H"
assert_bare pi "$H" 2>/dev/null \
	&& note ok "a truly bare home passes with no declaration" \
	|| note RED "a bare home was rejected"

H="$T/undeclared"; mkdir -p "$H/.pi/agent"; echo '{}' > "$H/.pi/agent/models-store.json"
assert_bare pi "$H" 2>/dev/null \
	&& note RED "an UNDECLARED model store passed" \
	|| note ok "an undeclared model store still fails"

assert_bare pi "$H" ".pi/agent/models-store.json" 2>/dev/null \
	&& note ok "the DECLARED model store passes" \
	|| note RED "the declared file was rejected"

H="$T/extra"; mkdir -p "$H/.pi/agent"
echo '{}' > "$H/.pi/agent/models-store.json"; echo 'x' > "$H/.pi/agent/other.json"
assert_bare pi "$H" ".pi/agent/models-store.json" 2>/dev/null \
	&& note RED "a file BESIDE the declared one passed — a declaration waved the directory through" \
	|| note ok "a file beside the declared one still fails"

echo "[assert_bare] $([ $F -eq 0 ] && echo OK || echo RED)"
exit $F
