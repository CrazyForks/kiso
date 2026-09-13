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
# A cheap count from what is already on disk, for a ceiling check BETWEEN
# segments. It is a lower bound, not an audit: the authoritative count is the
# extractor's, and this exists only to stop a runaway before it spends more.
requests_so_far() {
	_work=$1; _tool=$2
	# `grep -c` EXITS 1 on zero matches while printing a perfectly good 0,
	# so `|| echo 0` appended a SECOND zero and the caller compared "0\n0"
	# against a number. The count is taken from grep's output alone and its
	# exit status is discarded.
	case "$_tool" in
		kiso) find "$_work/kiso-home/sessions" -name '*.jsonl' -exec cat {} + 2>/dev/null | grep -c '"type":"usage"' | head -1 ;;
		*)    cat "$_work"/stdout-*.log 2>/dev/null | grep -c '"type":"message_end"\|"usage"' | head -1 ;;
	esac
}

# mark_incomplete <workdir> <reason> <detail>
mark_incomplete() {
	printf 'incomplete:%s\n' "$2" > "$1/status"
	printf '%s\n' "$3" > "$1/status_detail"
}

mark_complete() { printf 'complete\n' > "$1/status"; }
