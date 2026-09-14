import { parseArgs } from "./parse.js";
import { aggregate, sortEntries, ownerWidth, atLeast } from "./compute.js";
import { formatTable, formatJson } from "./format.js";
import { readFileSync } from "node:fs";

export function run(argv) {
	const opts = parseArgs(argv);
	const rows = JSON.parse(readFileSync(opts.file, "utf8"));
	const entries = atLeast(sortEntries(aggregate(rows), opts.sort), opts.min);
	return opts.json ? formatJson(entries) : formatTable(entries, ownerWidth(rows));
}
