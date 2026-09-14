import { readFileSync } from "node:fs";

export function importerRead(path) {
	// validate the record set
	const raw = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(raw)) throw new Error("expected an array of records");
	for (const [i, r] of raw.entries()) {
		if (r === null || typeof r !== "object") throw new Error(`record ${i} is not an object`);
		if (typeof r.owner !== "string" || r.owner === "") throw new Error(`record ${i} has no owner`);
		if (!Number.isFinite(r.amount)) throw new Error(`record ${i} has a non-numeric amount`);
		if (r.amount < 0) throw new Error(`record ${i} has a negative amount`);
	}
	return raw;
}

export function importerCount(path) {
	return importerRead(path).length;
}
