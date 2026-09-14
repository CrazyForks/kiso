// Argument parsing for the report tool.
export function parseArgs(argv) {
	const opts = { file: null, sort: "name", json: false, min: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--sort") { opts.sort = argv[++i] ?? "name"; continue; }
		if (a === "--json") { opts.json = true; continue; }
		if (a === "--min") {
			const v = Number.parseInt(argv[++i] ?? "", 10);
			if (!Number.isInteger(v)) throw new Error(`--min needs an integer`);
			opts.min = v; continue;
		}
		if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
		opts.file = a;
	}
	if (opts.sort !== "name" && opts.sort !== "total") throw new Error(`unknown sort: ${opts.sort}`);
	return opts;
}
