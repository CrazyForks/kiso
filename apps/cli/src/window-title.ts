/**
 * The terminal's window title (0.39.1, the owner's call).
 *
 * kiso set none, so a tab read whatever the shell left there — the
 * directory the shell happened to be in and the absolute path of a node
 * binary, identically for every kiso in every tab. The title is the one
 * place a terminal shows which session a tab holds without the user
 * switching to it, and it was the only screen kiso never wrote to.
 *
 * `kiso — <workspace>` at the start, `kiso — <session title> —
 * <workspace>` once the session has one. The session's title is
 * `sessionTitle`'s — the SAME projection the resume picker and `kiso
 * sessions` print, so a tab and the picker can never disagree about what
 * a session is called. That is also why an opener does not become the
 * title: the rule for "substantive" lives in one place and this is a
 * consumer of it, not a second opinion.
 *
 * WHAT IT WRITES. OSC 0, BEL-terminated — icon name and window title in
 * one sequence, the form every terminal that supports either accepts. It
 * goes STRAIGHT to stdout, deliberately outside the compositor: a title
 * occupies no cell and no column, so it is not in the width accounting
 * and must not be a cell that the repaint could move, cut, or scroll.
 *
 * WHAT IT NEVER WRITES. Anything at all when stdout is not a TTY. An OSC
 * into a pipe is bytes in someone's output, and the pipe-identity gates
 * exist because that has been a real defect before.
 *
 * NO RESTORE ON EXIT. Putting back what was there first requires reading
 * it, which no terminal reliably answers; the shell repaints its own
 * title on the next prompt anyway. A guess written on the way out would
 * be a title kiso invented, which is worse than one it left.
 *
 * AND NO `process.title`. The reference implementation sets one; kiso
 * does not, because two gates in this repo said no and the benefit was
 * that `ps` would print `kiso` instead of a node path.
 *
 *  - It overwrites the process's ARGV memory, so a renamed process shows
 *    as `kiso` with its arguments simply gone. The subagent's
 *    concurrency probe counts live children by matching `chat
 *    sub-parent-` in the command column; six renamed children were
 *    indistinguishable from each other and from nothing.
 *  - Setting it is not free on this platform: 14 ms measured for the
 *    first assignment on the machine this was written on, 7 ms for the
 *    second. A synchronous stall of that size on the main thread while a
 *    3,000-line paste is arriving wedges the PTY in both directions —
 *    the UD-1 byte-exact paste gate deadlocked reproducibly and passed
 *    the moment the assignment was removed.
 *
 * The window title is what was asked for; the process name was a detail
 * that came with it, and it costs more than it is worth.
 */

import { basename } from "node:path";
import type { Event } from "@vincemakes/kiso-core";
import { sessionTitle, type StoreRecord } from "@vincemakes/kiso-runtime/internal";
import { displayWidth, widthCut } from "@vincemakes/kiso-tui-cells/width";
import { escapeTerminal } from "@vincemakes/kiso-tui-cells/render";

/** OSC 0 — "set icon name and window title". */
export const OSC_TITLE_PREFIX = "\u001b]0;";
/** BEL, the terminator the reference form uses (ST works too; BEL is the
 *  one older terminals accept without argument). */
export const OSC_TITLE_SUFFIX = "\u0007";

/** The session title's share of the tab, in CELLS. A tab strip gives a
 *  title far less than a row, and the workspace — which says WHERE, the
 *  thing a human scanning tabs is usually after — must survive the cut. */
const TITLE_CELLS = 40;

/** The title a session with no title yet has. `sessionTitle` returns this
 *  when nothing has been asked; it is not a label, so it is not shown. */
const NO_TITLE = "(no prompt)";

/**
 * The text of the title, with no IO — the whole rule, testable.
 *
 * Every part is passed through `escapeTerminal` before it can reach the
 * sequence. A title is whatever a human typed or PASTED: a BEL in it
 * would end the sequence early and an ESC would begin another one, and
 * the title would stop being a title and start being commands to the
 * terminal. The same stripper the rendered surfaces use — one definition
 * of "what is safe to put on a terminal", not a second.
 */
export function windowTitleText(events: readonly Event[], workspace: string): string {
	const place = escapeTerminal(workspace);
	// Filtered BEFORE the wrap, so the cost is one object per user turn
	// rather than one per event — this is re-derived on every turn of a
	// session whose log may hold thousands. `sessionTitle` filters again;
	// it is the authority on what counts and this is not a second opinion.
	const inputs = events.filter((e) => e.type === "user_input");
	const raw = sessionTitle(inputs.map((event) => ({ runId: "", ts: 0, event }) as StoreRecord));
	if (raw === NO_TITLE) return `kiso — ${place}`;
	const safe = escapeTerminal(raw);
	// Cut by CELLS, not code points: a title of wide characters counts
	// two columns each, and a count of characters would overflow the tab
	// by as much again. The mark is inside the budget, never added to it.
	const shown = displayWidth(safe) > TITLE_CELLS ? `${widthCut(safe, TITLE_CELLS - 1)}…` : safe;
	return `kiso — ${shown} — ${place}`;
}

/** What was last written, so a repaint of the same title writes nothing.
 *  The title is re-derived on every bind and every user turn; most of
 *  those derive what is already on screen. */
let shown: string | null = null;

/**
 * Write the title for this session's state. Called where the session is
 * BOUND (which is one place for all three entry points — first start,
 * `/resume <id>`, and a switch) and again as the session's own title
 * becomes knowable, so a tab named before the first prompt is renamed by
 * it rather than keeping a name that was only ever a placeholder.
 */
export function paintWindowTitle(events: readonly Event[], cwd = process.cwd()): void {
	if (process.stdout.isTTY !== true) return;
	const text = windowTitleText(events, basename(cwd) || cwd);
	if (text === shown) return;
	shown = text;
	process.stdout.write(`${OSC_TITLE_PREFIX}${text}${OSC_TITLE_SUFFIX}`);
}
