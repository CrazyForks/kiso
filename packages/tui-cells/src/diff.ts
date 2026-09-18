/**
 * v2e — the diff renderer: edit/write changes as inline ± lines, zero
 * dependencies, no syntax highlighting (the spec's scope line). Shown at
 * the approval moment ONLY — the frozen summary stays one line (v2d's
 * anti-leak principle), /last has the full data.
 *
 * edit_file diffs IN PLACE (the search→replace windows are known — no
 * general engine needed); write_file does a row-level LCS over the old
 * file (small files are the target). Context: 2 rows each side. The
 * RENDERER truncates (18 head + 18 tail + "… N lines"); the stats come
 * from the full diff.
 */

/** The diff block's per-row kind. `note` (0.40.0) is kiso's sentence
 *  ABOUT the diff — the renderer's cut, a search that is not there or is
 *  there more than once — never a line of the file, so never drawn where
 *  the file's lines are. */
export type DiffLine = { kind: "-" | "+" | " " | "note"; text: string };

export interface DiffResult {
	/** The FULL diff (with context, not truncated) — the display truncates. */
	lines: DiffLine[];
	added: number;
	removed: number;
	/** Which of the three this result is. Set on EVERY result.
	 *
	 *  - `"diff"` — `lines` is a real diff and the counts are real
	 *  - `"not-found"` — the search is not in the file
	 *  - `"ambiguous"` — the search resolves in more than one place (ACI-2)
	 *
	 *  The last two carry an honest note in `lines` and zero counts: the
	 *  tool will refuse, so there is no edit to draw. */
	outcome?: "diff" | "not-found" | "ambiguous";
	/** TUI2-R1.5 ② (VD-2): the search is not in the file — the tool will
	 *  ERROR, so the panel shows the honest note carried in `lines` and
	 *  never a diff.
	 *
	 *  @deprecated Read `outcome`. This flag means *the search was not
	 *  found*; it has never meant *there is no diff*, and since ACI-2 those
	 *  are different things — an ambiguous search also produces a note with
	 *  no diff and does NOT set this flag. Its value is unchanged and will
	 *  stay `outcome === "not-found"`, so nothing that reads it today
	 *  changes meaning. */
	notFound?: true;
}

/** A line-level LCS diff — the classic two-row DP, ~small inputs. */
function lcsDiff(oldLines: string[], newLines: string[]): DiffLine[] {
	const n = oldLines.length;
	const m = newLines.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			dp[i]![j] = oldLines[i] === newLines[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (oldLines[i] === newLines[j]) {
			out.push({ kind: " ", text: oldLines[i]! });
			i += 1;
			j += 1;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
			out.push({ kind: "-", text: oldLines[i]! });
			i += 1;
		} else {
			out.push({ kind: "+", text: newLines[j]! });
			j += 1;
		}
	}
	while (i < n) {
		out.push({ kind: "-", text: oldLines[i]! });
		i += 1;
	}
	while (j < m) {
		out.push({ kind: "+", text: newLines[j]! });
		j += 1;
	}
	return out;
}

/** Keep 2 context rows around each change — the unified-style window. */
function withContext(diff: DiffLine[]): DiffLine[] {
	const out: DiffLine[] = [];
	let lastAdded = -10;
	for (let k = 0; k < diff.length; k += 1) {
		if (diff[k]!.kind === " ") continue;
		const from = Math.max(0, k - 2);
		const to = Math.min(diff.length - 1, k + 2);
		for (let c = from; c <= to; c += 1) {
			if (c > lastAdded) {
				out.push(diff[c]!);
				lastAdded = c;
			}
		}
		lastAdded = to;
	}
	return out;
}

const MAX_DIFF_LINES = 40; // the RENDERED cap
const TRUNCATE_KEEP = 18;

/** The RENDERER's truncation: head + "… N lines (/last for full)" + tail. */
export function truncateDiff(diff: DiffLine[]): DiffLine[] {
	if (diff.length <= MAX_DIFF_LINES) return diff;
	const omitted = diff.length - 2 * TRUNCATE_KEEP;
	return [
		...diff.slice(0, TRUNCATE_KEEP),
		{ kind: "note", text: `… ${omitted} lines (/last for full)` },
		...diff.slice(diff.length - TRUNCATE_KEEP),
	];
}

function stats(diff: DiffLine[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const d of diff) {
		if (d.kind === "+") added += 1;
		else if (d.kind === "-") removed += 1;
	}
	return { added, removed };
}

/** edit_file: the preview of a CHARACTER splice.
 *
 *  TUI2-R1.5 ② (VD-2): the locator is the tool's own, verbatim — the
 *  workspace edit_file does `i = text.indexOf(search)` and writes
 *  `text.slice(0, i) + replace + text.slice(i + search.length)`. This
 *  function mirrors those two lines and diffs the result against the
 *  original; it does not model the edit, it reproduces it.
 *
 *  The retired locator required the search to align to FULL LINES. A
 *  mid-line search ("// OLD" inside "  // OLD") therefore missed, and
 *  the miss branch rendered the WHOLE FILE as the old side: a one-line
 *  edit was drawn as a catastrophic rewrite, on the approval panel, at
 *  the moment a human was deciding whether to allow it. A preview that
 *  can be that wrong is worse than no preview.
 *
 *  A genuine miss is now reported as a miss: the tool will return
 *  `pattern not found in <path>` and change nothing, so the panel says
 *  exactly that instead of inventing a diff for an edit that will not
 *  happen. `path` names the file in that note.
 *
 *  Since ACI-2 an AMBIGUOUS search is the second case of the same rule:
 *  the tool refuses it, so there is no edit to draw. */
export function editFileDiff(oldContent: string, search: string, replace: string, path?: string): DiffResult {
	const at = oldContent.indexOf(search);
	if (at < 0) {
		return {
			lines: [{ kind: "note", text: `pattern not found in ${path ?? "the file"}` }],
			added: 0,
			removed: 0,
			outcome: "not-found",
			notFound: true,
		};
	}
	// ACI-2: an ambiguous search is REFUSED by the tool, and this diff is
	// drawn for the APPROVAL PANEL — before the tool runs. Previewing the
	// first of N places showed a human the very edit ACI-2 exists to
	// prevent, then asked them to approve one that would not happen. The
	// same rule as the miss above, for the same reason.
	if (search.length > 0 && oldContent.indexOf(search, at + 1) > at) {
		return {
			lines: [{ kind: "note", text: `pattern matches more than one place in ${path ?? "the file"}` }],
			added: 0,
			removed: 0,
			outcome: "ambiguous",
		};
	}
	const result = oldContent.slice(0, at) + replace + oldContent.slice(at + search.length);
	const lines = withContext(lcsDiff(oldContent.split("\n"), result.split("\n")));
	return { lines, ...stats(lines), outcome: "diff" };
}

/** write_file: a new file is all +; an existing file diffs row-level
 *  against its old content. */
export function writeFileDiff(oldContent: string | null, newContent: string): DiffResult {
	if (oldContent === null) {
		const lines = newContent.split("\n").map((text) => ({ kind: "+" as const, text }));
		return { lines, added: lines.length, removed: 0, outcome: "diff" };
	}
	const lines = withContext(lcsDiff(oldContent.split("\n"), newContent.split("\n")));
	return { lines, ...stats(lines), outcome: "diff" };
}
