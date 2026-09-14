// Aggregate raw rows into per-owner totals.
export function aggregate(rows) {
	const byOwner = new Map();
	for (const r of rows) byOwner.set(r.owner, (byOwner.get(r.owner) ?? 0) + r.amount);
	return [...byOwner].map(([owner, total]) => ({ owner, total }));
}

export function sortEntries(entries, sort) {
	const copy = [...entries];
	if (sort === "total") copy.sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));
	else copy.sort((a, b) => a.owner.localeCompare(b.owner));
	return copy;
}
