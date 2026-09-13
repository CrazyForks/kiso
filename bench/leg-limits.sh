#!/bin/sh
# PER-LEG HARD LIMITS — wall clock and request ceiling.
#
# A leg had neither. A hung arm ran until someone noticed; a looping arm
# spent the programme's budget on one task. With caps of ¥50, 3,500 requests
# and 12 summed hours, the first uncontrolled leg is the one that decides
# which axis never gets measured.
#
# The contract when a limit is hit is as important as the limit:
#   - the partial logs STAY. A killed leg's output is evidence, not litter.
#   - the usage already spent is still extracted and charged. Stopping does
#     not make the tokens unspent, and a cap reconciliation that ignores
#     killed legs under-counts exactly the runs that cost most.
#   - the leg is marked INCOMPLETE with its reason, never `fail`. A product
#     that would have finished in one more minute did not fail its task; it
#     hit OUR limit, and a comparison that scores those together is
#     measuring the harness.
#
# macOS ships no `timeout(1)`; perl's alarm is this repo's substitute.

# run_bounded <seconds> <logfile> <command...>
# exit 0 = finished inside the bound; 142 = killed at the deadline.
run_bounded() {
	_secs=$1; _log=$2; shift 2
	# The kill is DELIBERATE, so the shell's "Alarm clock" notice is noise in
	# a harness whose output is read as evidence.
	{ perl -e 'alarm shift; exec @ARGV' "$_secs" "$@" > "$_log" 2>&1; _rc=$?; } 2>/dev/null
	# perl's alarm kills with SIGALRM (14) -> 142 through the shell
	return $_rc
}

# requests_so_far <workdir> <tool>
#
# Delegates to requests-so-far.mjs, which uses THE EXTRACTOR'S definition of a
# request, per arm. The first version grepped for lines containing "usage":
# pi carries a usage block on every streaming `message_update`, so a healthy
# leg four requests in counted as 551 and this ceiling stopped it. A leg
# recorded as "hit the request ceiling" would have been a false finding about
# a product, produced entirely by our own counter.
#
# The ceiling and the ledger must count the same thing, or the cap is
# measuring something the budget is not made of.
requests_so_far() {
	# `$0` inside a SOURCED file is the SOURCING script, not this one — so
	# resolving the helper from it worked in run-t5.sh (which lives in bench/)
	# and silently found nothing from bench/tests/. The caller's $B is the
	# bench directory; the $0 fallback is only for a direct run from bench/.
	_bench=${B:-$(cd "$(dirname "$0")" && pwd)}
	_n=$(node "$_bench/requests-so-far.mjs" "$1" "$2" 2>/dev/null) || _n=0
	[ -n "$_n" ] || _n=0
	echo "$_n"
}

# mark_incomplete <workdir> <reason> <detail>
mark_incomplete() {
	printf 'incomplete:%s\n' "$2" > "$1/status"
	printf '%s\n' "$3" > "$1/status_detail"
}

mark_complete() { printf 'complete\n' > "$1/status"; }
