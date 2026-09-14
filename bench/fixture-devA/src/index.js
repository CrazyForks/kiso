import { parseArgs } from "./parse.js";
import { aggregate, sortEntries } from "./compute.js";
import { formatTable, formatJson } from "./format.js";
import { readFileSync } from "node:fs";

export function run(argv) {
	const opts = parseArgs(argv);
	const rows = JSON.parse(readFileSync(opts.file, "utf8"));
	const entries = sortEntries(aggregate(rows), opts.sort);
	return opts.json ? formatJson(entries) : formatTable(entries);
}
