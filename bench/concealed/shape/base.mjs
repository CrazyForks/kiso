/**
 * The base module — what makes a fixture's files LONG.
 *
 * Design requirement 5: a benchmark whose files fit in one read measures a
 * world in which read policy is moot. Every family's fixture files are
 * built here: plausible, valid JavaScript (exported helpers with doc
 * comments, grouped in sections), grown to a length drawn from the corpus
 * fit in prng.mjs, with the work-relevant functions inserted at a DRAWN
 * position — so in a long file the thing the task is about lies past the
 * default read window about as often as the corpus says reads truncate.
 *
 * Filler helpers are real code the module's own tests never reach; their
 * names come from a pool disjoint from the contract names, so an inserted
 * contract can never collide with filler.
 */

const VERBS = ["normalize", "format", "describe", "summarize", "resolve", "compose", "render", "measure", "derive", "classify", "label", "encode"];
const NOUNS = ["Label", "Entry", "Record", "Header", "Token", "Segment", "Field", "Marker", "Slot", "Badge", "Caption", "Tag"];

/** One filler helper: a doc comment and a small exported function, drawn. */
function fillerHelper(rng, name) {
	const kind = rng.int(0, 5);
	const k = rng.int(2, 9);
	switch (kind) {
		case 0:
			return [
				`/** ${name}: trims the value and collapses inner whitespace. */`,
				`export function ${name}(value) {`,
				`\treturn String(value).trim().replace(/\\s+/g, " ");`,
				`}`,
			];
		case 1:
			return [
				`/**`,
				` * ${name}: pads a label to ${k * 4} characters for aligned output.`,
				` * Longer labels are returned unchanged.`,
				` */`,
				`export function ${name}(label) {`,
				`\tconst text = String(label);`,
				`\treturn text.length >= ${k * 4} ? text : text + " ".repeat(${k * 4} - text.length);`,
				`}`,
			];
		case 2:
			return [
				`/** ${name}: a shallow copy of the record with the named key removed. */`,
				`export function ${name}(record, key) {`,
				`\tconst out = { ...record };`,
				`\tdelete out[key];`,
				`\treturn out;`,
				`}`,
			];
		case 3:
			return [
				`/**`,
				` * ${name}: groups items by the value of \`key\`.`,
				` * The groups keep the items' original order.`,
				` */`,
				`export function ${name}(items, key) {`,
				`\tconst groups = new Map();`,
				`\tfor (const item of items) {`,
				`\t\tconst group = groups.get(item[key]) ?? [];`,
				`\t\tgroup.push(item);`,
				`\t\tgroups.set(item[key], group);`,
				`\t}`,
				`\treturn groups;`,
				`}`,
			];
		case 4:
			return [
				`/** ${name}: the value rounded to ${k % 4} decimal places, as a string. */`,
				`export function ${name}(value) {`,
				`\treturn Number(value).toFixed(${k % 4});`,
				`}`,
			];
		default:
			return [
				`/**`,
				` * ${name}: a lowercase, dash-separated identifier for display names.`,
				` * Characters outside [a-z0-9] become dashes; runs of dashes collapse.`,
				` */`,
				`export function ${name}(text) {`,
				`\treturn String(text)`,
				`\t\t.toLowerCase()`,
				`\t\t.replace(/[^a-z0-9]+/g, "-")`,
				`\t\t.replace(/^-|-$/g, "");`,
				`}`,
			];
	}
}

/**
 * Build a module of about `lines` lines with `inserts` (arrays of source
 * lines) placed at a drawn position. Returns the text, its line count, and
 * the 1-based line each insert starts on — the position the task's
 * work-relevant function actually occupies, which check-shape reports.
 */
export function buildModule(rng, { lines, title, inserts }) {
	const header = [`// ${title}`, `//`, `// Helpers shared across the package. Sections are grouped by concern.`, ``];
	const insertLines = inserts.reduce((n, block) => n + block.length + 1, 0);
	const fillerTarget = Math.max(0, lines - header.length - insertLines);
	const filler = [];
	const used = new Set();
	let section = 0;
	while (filler.length < fillerTarget) {
		if (filler.length === 0 || rng.next() < 0.12) {
			section += 1;
			filler.push(``, `// ── section ${section} ${"─".repeat(40)}`, ``);
		}
		let name;
		do name = `${rng.pick(VERBS)}${rng.pick(NOUNS)}${used.size > 40 ? used.size : ""}`;
		while (used.has(name));
		used.add(name);
		filler.push(...fillerHelper(rng, name), ``);
	}
	// the inserts go in at drawn points within the filler, in order
	const body = [...filler];
	const at = inserts.map(() => rng.int(0, body.length)).sort((a, b) => a - b);
	const starts = [];
	for (let i = inserts.length - 1; i >= 0; i -= 1) {
		// snap to a blank line so an insert never splits a helper
		let p = at[i];
		while (p > 0 && body[p - 1] !== "") p -= 1;
		body.splice(p, 0, ...inserts[i], "");
	}
	const all = [...header, ...body];
	const text = `${all.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
	const outLines = text.split("\n");
	for (const block of inserts) {
		const idx = outLines.indexOf(block[0]);
		starts.push(idx + 1);
	}
	return { text, lines: outLines.length - 1, starts };
}
