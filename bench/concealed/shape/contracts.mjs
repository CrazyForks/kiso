/**
 * The contract pool — the units families A, C and F are built from.
 *
 * A contract is a STATEMENT (the words a turn gives the agent), a REFERENCE
 * implementation, and CHECKS: inputs, each carrying the clause of the
 * statement that requires it. The expected value of a check is never
 * written here — the generator computes it by running the reference, so
 * the verifier is generated from the same spec the task is (design rule 1)
 * and every assertion cites the words that ask for it (rule 2).
 *
 * The boundary checks are the ones the statement ITSELF names: an empty
 * input where the statement says what empty returns, the value at a stated
 * bound, a stated tie rule, order-independence where it says so. A check
 * whose clause is not in the statement does not belong here.
 *
 * Four kinds, the design's: ordering, set arithmetic, interval algebra,
 * string segmentation. Each template draws its function name from a pool,
 * so the same contract reads differently across instances.
 */

const NAMES = {
	largest: ["largest", "maxOf", "highest", "peak"],
	smallest: ["smallest", "minOf", "lowest", "floorOf"],
	total: ["total", "sumOf", "addUp", "grandTotal"],
	uniqSorted: ["uniqueSorted", "distinctAscending", "sortedSet", "orderedUnique"],
	secondLargest: ["secondLargest", "runnerUp", "nextHighest"],
	rankOf: ["rankOf", "positionOf", "placeOf"],
	topN: ["topN", "leaders", "bestN"],
	median: ["median", "middleValue", "centerOf"],
	union: ["unionOf", "merged", "combined"],
	intersect: ["intersection", "common", "shared"],
	difference: ["without", "difference", "minus"],
	symDiff: ["symmetricDifference", "eitherNotBoth", "exclusive"],
	isSubset: ["isSubset", "within", "containedIn"],
	countDistinct: ["countDistinct", "distinctCount", "uniqueCount"],
	overlaps: ["overlaps", "intersects", "touches"],
	mergeRanges: ["mergeRanges", "coalesce", "collapseRanges"],
	span: ["totalSpan", "coveredCount", "spanOf"],
	clampTo: ["clampTo", "boundTo", "limitTo"],
	containsPoint: ["containsPoint", "covers", "inRange"],
	gapBetween: ["gapBetween", "distanceBetween", "spaceBetween"],
	words: ["splitWords", "wordsOf", "tokens"],
	longestRun: ["longestRun", "maxStreak", "longestStreak"],
	chunk: ["chunkText", "slices", "piecesOf"],
	initials: ["initialsOf", "acronym", "firstLetters"],
	capitalize: ["capitalizeWords", "titleCase", "headline"],
	countChar: ["countChar", "occurrences", "timesOf"],
};

/** Each template: kind, the name pool key, and make(rng) → { name, args, statement, impl, checks }.
 *  `checks` is [{ args, clause }] — `clause` is a verbatim substring of `statement`. */
export const CONTRACTS = [
	// ── ordering ────────────────────────────────────────────────────────
	{
		id: "largest",
		kind: "ordering",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): the largest number in the array values, or null when the array is empty.`,
			impl: `function ${name}(values) { if (values.length === 0) return null; return values.reduce((a, b) => (b > a ? b : a)); }`,
			checks: [
				{ args: [[3, 9, 2]], clause: "the largest number in the array values" },
				{ args: [[-5, -2, -9]], clause: "the largest number in the array values" },
				{ args: [[]], clause: "or null when the array is empty" },
			],
		}),
	},
	{
		id: "smallest",
		kind: "ordering",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): the smallest number in the array values, or null when the array is empty.`,
			impl: `function ${name}(values) { if (values.length === 0) return null; return values.reduce((a, b) => (b < a ? b : a)); }`,
			checks: [
				{ args: [[3, 9, 2]], clause: "the smallest number in the array values" },
				{ args: [[7]], clause: "the smallest number in the array values" },
				{ args: [[]], clause: "or null when the array is empty" },
			],
		}),
	},
	{
		id: "total",
		kind: "ordering",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): the sum of the numbers in values; 0 when values is empty.`,
			impl: `function ${name}(values) { return values.reduce((a, b) => a + b, 0); }`,
			checks: [
				{ args: [[1, 2, 3.5]], clause: "the sum of the numbers in values" },
				{ args: [[]], clause: "0 when values is empty" },
			],
		}),
	},
	{
		id: "uniqSorted",
		kind: "ordering",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): a new array of the distinct numbers in values, in ascending order; the input is not modified.`,
			impl: `function ${name}(values) { return [...new Set(values)].sort((a, b) => a - b); }`,
			checks: [
				{ args: [[3, 1, 3, 10, 2]], clause: "the distinct numbers in values, in ascending order" },
				{ args: [[]], clause: "a new array of the distinct numbers in values" },
			],
		}),
	},
	{
		id: "secondLargest",
		kind: "ordering",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): the second-largest DISTINCT number in values, or null when values has fewer than two distinct numbers.`,
			impl: `function ${name}(values) { const d = [...new Set(values)].sort((a, b) => b - a); return d.length < 2 ? null : d[1]; }`,
			checks: [
				{ args: [[4, 9, 7]], clause: "the second-largest DISTINCT number in values" },
				{ args: [[9, 9, 4]], clause: "the second-largest DISTINCT number in values" },
				{ args: [[5, 5]], clause: "or null when values has fewer than two distinct numbers" },
				{ args: [[]], clause: "or null when values has fewer than two distinct numbers" },
			],
		}),
	},
	{
		id: "rankOf",
		kind: "ordering",
		make: (name) => ({
			params: "values, x",
			statement: `${name}(values, x): how many numbers in values are strictly less than x.`,
			impl: `function ${name}(values, x) { return values.filter((v) => v < x).length; }`,
			checks: [
				{ args: [[1, 5, 3, 7], 5], clause: "how many numbers in values are strictly less than x" },
				{ args: [[2, 2, 2], 2], clause: "strictly less than x" },
				{ args: [[], 4], clause: "how many numbers in values are strictly less than x" },
			],
		}),
	},
	{
		id: "topN",
		kind: "ordering",
		make: (name) => ({
			params: "values, n",
			statement: `${name}(values, n): the n largest numbers of values in descending order; all of them, sorted descending, when values has fewer than n.`,
			impl: `function ${name}(values, n) { return [...values].sort((a, b) => b - a).slice(0, n); }`,
			checks: [
				{ args: [[5, 1, 9, 3], 2], clause: "the n largest numbers of values in descending order" },
				{ args: [[2, 8], 5], clause: "all of them, sorted descending, when values has fewer than n" },
			],
		}),
	},
	{
		id: "median",
		kind: "ordering",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): the median of values — the middle number after sorting, or the mean of the two middle numbers when the count is even; null when values is empty.`,
			impl: `function ${name}(values) { if (values.length === 0) return null; const s = [...values].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }`,
			checks: [
				{ args: [[7, 1, 3]], clause: "the middle number after sorting" },
				{ args: [[4, 1, 3, 2]], clause: "the mean of the two middle numbers when the count is even" },
				{ args: [[]], clause: "null when values is empty" },
			],
		}),
	},
	// ── set arithmetic ──────────────────────────────────────────────────
	{
		id: "union",
		kind: "set",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): the numbers present in a or in b, each once, in ascending order.`,
			impl: `function ${name}(a, b) { return [...new Set([...a, ...b])].sort((x, y) => x - y); }`,
			checks: [
				{ args: [[3, 1], [2, 3]], clause: "the numbers present in a or in b, each once, in ascending order" },
				{ args: [[], []], clause: "the numbers present in a or in b" },
			],
		}),
	},
	{
		id: "intersect",
		kind: "set",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): the numbers present in both a and b, each once, in ascending order.`,
			impl: `function ${name}(a, b) { const s = new Set(b); return [...new Set(a.filter((x) => s.has(x)))].sort((x, y) => x - y); }`,
			checks: [
				{ args: [[5, 1, 3, 3], [3, 5, 8]], clause: "the numbers present in both a and b, each once, in ascending order" },
				{ args: [[1, 2], []], clause: "the numbers present in both a and b" },
			],
		}),
	},
	{
		id: "difference",
		kind: "set",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): the numbers of a that are not in b, each once, in the order they first appear in a.`,
			impl: `function ${name}(a, b) { const s = new Set(b); const seen = new Set(); const out = []; for (const x of a) { if (!s.has(x) && !seen.has(x)) { seen.add(x); out.push(x); } } return out; }`,
			checks: [
				{ args: [[4, 1, 4, 2, 9], [2]], clause: "each once, in the order they first appear in a" },
				{ args: [[1, 2], [1, 2]], clause: "the numbers of a that are not in b" },
			],
		}),
	},
	{
		id: "symDiff",
		kind: "set",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): the numbers in exactly one of a and b, each once, in ascending order.`,
			impl: `function ${name}(a, b) { const sa = new Set(a); const sb = new Set(b); return [...new Set([...a, ...b])].filter((x) => sa.has(x) !== sb.has(x)).sort((x, y) => x - y); }`,
			checks: [
				{ args: [[1, 2, 3], [3, 4]], clause: "the numbers in exactly one of a and b, each once, in ascending order" },
				{ args: [[5], [5]], clause: "the numbers in exactly one of a and b" },
			],
		}),
	},
	{
		id: "isSubset",
		kind: "set",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): true when every number in a also appears in b; true when a is empty.`,
			impl: `function ${name}(a, b) { const s = new Set(b); return a.every((x) => s.has(x)); }`,
			checks: [
				{ args: [[1, 2], [2, 1, 3]], clause: "true when every number in a also appears in b" },
				{ args: [[1, 4], [1, 2]], clause: "true when every number in a also appears in b" },
				{ args: [[], [1]], clause: "true when a is empty" },
			],
		}),
	},
	{
		id: "countDistinct",
		kind: "set",
		make: (name) => ({
			params: "values",
			statement: `${name}(values): how many distinct values the array holds; 0 for an empty array.`,
			impl: `function ${name}(values) { return new Set(values).size; }`,
			checks: [
				{ args: [[1, 1, 2, 3, 3]], clause: "how many distinct values the array holds" },
				{ args: [[]], clause: "0 for an empty array" },
			],
		}),
	},
	// ── interval algebra ────────────────────────────────────────────────
	{
		id: "overlaps",
		kind: "interval",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): true when the inclusive integer ranges a and b ({ start, end }) share at least one integer.`,
			impl: `function ${name}(a, b) { return a.start <= b.end && b.start <= a.end; }`,
			checks: [
				{ args: [{ start: 1, end: 5 }, { start: 5, end: 9 }], clause: "share at least one integer" },
				{ args: [{ start: 1, end: 4 }, { start: 5, end: 9 }], clause: "share at least one integer" },
				{ args: [{ start: 3, end: 6 }, { start: 1, end: 10 }], clause: "share at least one integer" },
			],
		}),
	},
	{
		id: "mergeRanges",
		kind: "interval",
		make: (name) => ({
			params: "ranges",
			statement: `${name}(ranges): given an array of inclusive ranges { start, end }, the minimal list covering the same integers — sorted by start, ranges that overlap merged into one; an empty array for an empty input.`,
			impl: `function ${name}(ranges) { const s = [...ranges].sort((a, b) => a.start - b.start); const out = []; for (const r of s) { const last = out[out.length - 1]; if (last && r.start <= last.end) last.end = Math.max(last.end, r.end); else out.push({ start: r.start, end: r.end }); } return out; }`,
			checks: [
				{ args: [[{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 2, end: 4 }]], clause: "sorted by start, ranges that overlap merged into one" },
				{ args: [[]], clause: "an empty array for an empty input" },
			],
		}),
	},
	{
		id: "span",
		kind: "interval",
		make: (name) => ({
			params: "ranges",
			statement: `${name}(ranges): how many distinct integers the inclusive ranges { start, end } cover together — an integer covered twice counts once; 0 for an empty array.`,
			impl: `function ${name}(ranges) { const s = [...ranges].sort((a, b) => a.start - b.start); let n = 0; let end = -Infinity; for (const r of s) { const lo = Math.max(r.start, end + 1); if (r.end >= lo) n += r.end - lo + 1; end = Math.max(end, r.end); } return n; }`,
			checks: [
				{ args: [[{ start: 1, end: 3 }, { start: 10, end: 10 }]], clause: "how many distinct integers the inclusive ranges { start, end } cover together" },
				{ args: [[{ start: 1, end: 5 }, { start: 3, end: 7 }]], clause: "an integer covered twice counts once" },
				{ args: [[]], clause: "0 for an empty array" },
			],
		}),
	},
	{
		id: "clampTo",
		kind: "interval",
		make: (name) => ({
			params: "n, range",
			statement: `${name}(n, range): n limited to the inclusive range { start, end } — start when n is below it, end when n is above it, n otherwise.`,
			impl: `function ${name}(n, range) { return n < range.start ? range.start : n > range.end ? range.end : n; }`,
			checks: [
				{ args: [-3, { start: 0, end: 10 }], clause: "start when n is below it" },
				{ args: [11, { start: 0, end: 10 }], clause: "end when n is above it" },
				{ args: [10, { start: 0, end: 10 }], clause: "n otherwise" },
			],
		}),
	},
	{
		id: "containsPoint",
		kind: "interval",
		make: (name) => ({
			params: "range, n",
			statement: `${name}(range, n): true when range.start <= n <= range.end.`,
			impl: `function ${name}(range, n) { return range.start <= n && n <= range.end; }`,
			checks: [
				{ args: [{ start: 2, end: 6 }, 2], clause: "range.start <= n <= range.end" },
				{ args: [{ start: 2, end: 6 }, 6], clause: "range.start <= n <= range.end" },
				{ args: [{ start: 2, end: 6 }, 7], clause: "range.start <= n <= range.end" },
			],
		}),
	},
	{
		id: "gapBetween",
		kind: "interval",
		make: (name) => ({
			params: "a, b",
			statement: `${name}(a, b): how many integers lie strictly between the inclusive ranges a and b; 0 when they overlap or touch.`,
			impl: `function ${name}(a, b) { const [x, y] = a.start <= b.start ? [a, b] : [b, a]; return Math.max(0, y.start - x.end - 1); }`,
			checks: [
				{ args: [{ start: 1, end: 3 }, { start: 7, end: 9 }], clause: "how many integers lie strictly between the inclusive ranges a and b" },
				{ args: [{ start: 7, end: 9 }, { start: 1, end: 3 }], clause: "how many integers lie strictly between the inclusive ranges a and b" },
				{ args: [{ start: 1, end: 3 }, { start: 4, end: 9 }], clause: "0 when they overlap or touch" },
			],
		}),
	},
	// ── string segmentation ─────────────────────────────────────────────
	{
		id: "words",
		kind: "string",
		make: (name) => ({
			params: "text",
			statement: `${name}(text): the words of text — runs of non-space characters — in order; an empty array when text has none.`,
			impl: `function ${name}(text) { return text.split(/\\s+/).filter((w) => w !== ""); }`,
			checks: [
				{ args: ["  alpha beta\tgamma  "], clause: "runs of non-space characters" },
				{ args: ["   "], clause: "an empty array when text has none" },
			],
		}),
	},
	{
		id: "longestRun",
		kind: "string",
		make: (name) => ({
			params: "text",
			statement: `${name}(text): the length of the longest run of one repeated character in text; 0 for an empty string.`,
			impl: `function ${name}(text) { let best = 0; let run = 0; for (let i = 0; i < text.length; i += 1) { run = i > 0 && text[i] === text[i - 1] ? run + 1 : 1; if (run > best) best = run; } return best; }`,
			checks: [
				{ args: ["aabbbbc"], clause: "the length of the longest run of one repeated character in text" },
				{ args: [""], clause: "0 for an empty string" },
			],
		}),
	},
	{
		id: "chunk",
		kind: "string",
		make: (name) => ({
			params: "text, size",
			statement: `${name}(text, size): text cut into consecutive pieces of size characters; the last piece holds what is left and may be shorter; an empty array for an empty string.`,
			impl: `function ${name}(text, size) { const out = []; for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size)); return out; }`,
			checks: [
				{ args: ["abcdefg", 3], clause: "the last piece holds what is left and may be shorter" },
				{ args: ["", 4], clause: "an empty array for an empty string" },
			],
		}),
	},
	{
		id: "initials",
		kind: "string",
		make: (name) => ({
			params: "text",
			statement: `${name}(text): the first letter of each word of text, uppercased and joined with no separator; an empty string when text has no words.`,
			impl: `function ${name}(text) { return text.split(/\\s+/).filter((w) => w !== "").map((w) => w[0].toUpperCase()).join(""); }`,
			checks: [
				{ args: ["portable network graphics"], clause: "the first letter of each word of text, uppercased and joined with no separator" },
				{ args: [""], clause: "an empty string when text has no words" },
			],
		}),
	},
	{
		id: "capitalize",
		kind: "string",
		make: (name) => ({
			params: "text",
			statement: `${name}(text): text with the first letter of every word uppercased and the rest of each word unchanged; single spaces between words are kept as they are.`,
			impl: `function ${name}(text) { return text.split(" ").map((w) => (w === "" ? w : w[0].toUpperCase() + w.slice(1))).join(" "); }`,
			checks: [
				{ args: ["make it so"], clause: "the first letter of every word uppercased" },
				{ args: ["mIxed caSe"], clause: "the rest of each word unchanged" },
			],
		}),
	},
	{
		id: "countChar",
		kind: "string",
		make: (name) => ({
			params: "text, ch",
			statement: `${name}(text, ch): how many times the single character ch occurs in text; 0 when it does not occur.`,
			impl: `function ${name}(text, ch) { let n = 0; for (const c of text) if (c === ch) n += 1; return n; }`,
			checks: [
				{ args: ["banana", "a"], clause: "how many times the single character ch occurs in text" },
				{ args: ["banana", "z"], clause: "0 when it does not occur" },
			],
		}),
	},
];

/** Draw a contract instance: the template, with its name drawn and made unique
 *  against `taken` (so two contracts in one instance never share a name). */
export function drawContract(rng, template, taken) {
	const pool = NAMES[template.id];
	const options = pool.filter((n) => !taken.has(n));
	const name = options.length > 0 ? rng.pick(options) : `${pool[0]}${taken.size}`;
	taken.add(name);
	const c = template.make(name);
	for (const check of c.checks) {
		if (!c.statement.includes(check.clause)) throw new Error(`contract ${template.id}: clause not in its statement: ${check.clause}`);
	}
	return { id: template.id, kind: template.kind, name, ...c };
}
