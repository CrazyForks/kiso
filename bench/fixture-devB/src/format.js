// Render entries as a fixed-width table.
export function formatTable(entries, widthHint) {
	const w = Math.max(5, widthHint ?? 0, ...entries.map((e) => e.owner.length));
	const lines = [`${"owner".padEnd(w)}  total`];
	for (const e of entries) lines.push(`${e.owner.padEnd(w)}  ${String(e.total).padStart(5)}`);
	return lines.join("\n");
}

export function formatJson(entries) {
	return JSON.stringify(entries, null, 1);
}
