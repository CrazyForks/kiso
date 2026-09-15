"""
F33-RR3 (Astra) — ONE definition of "did the provider report this
request's usage", shared by every extractor.

The TypeScript validator rejects a non-boolean `usageKnown`, and both
Python extractors parse the sidecar themselves without ever calling it.
They tested `is False`, so a record carrying the STRING "false" was not
unknown — and because the key was present, it also skipped the pre-v5
fallback that would have consulted the sibling plain log. A malformed
marker therefore read as a fully measured request, which is the exact
defect the marker was introduced to close, arriving through the one door
nobody had checked.

The rule, stated once because two copies of a policy is how the four
sites below drifted apart in the first place: a completeness marker is
believed only when it is a BOOLEAN. Anything else present is corruption
in the writer, and corruption is never read as good news.
"""

MISSING = "missing"  # pre-v5: the generation had no way to say
KNOWN = "known"  # the provider reported
UNKNOWN = "unknown"  # the provider did not
MALFORMED = "malformed"  # a marker present but not a boolean


def usage_marker(rec):
	"""Classify a trace record's completeness marker. Never raises."""
	if not isinstance(rec, dict) or "usageKnown" not in rec:
		return MISSING
	v = rec["usageKnown"]
	# `is True` / `is False` on purpose: JSON true/false parse to bools,
	# while 1 and 0 compare EQUAL to them and are not the same statement.
	if v is True:
		return KNOWN
	if v is False:
		return UNKNOWN
	return MALFORMED


def unmeasured(marker):
	"""Does this marker mean the request's cost is not a measurement?
	MALFORMED counts here: a leg whose ledger is corrupt is not a leg
	whose requests were free."""
	return marker in (UNKNOWN, MALFORMED)
