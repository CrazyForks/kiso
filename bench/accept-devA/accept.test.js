// HIDDEN ACCEPTANCE for task A — written before the round, never in the
// workspace the agent works in. Copied in at verify time, run against the
// workspace's src/.
import { strict as assert } from "node:assert";
import { parseArgs } from "../src/parse.js";
import { aggregate, sortEntries, topN } from "../src/compute.js";
import { formatTable } from "../src/format.js";
import { run } from "../src/index.js";

// 1. the option parses, and its absence is null (not 0, not Infinity)
assert.equal(parseArgs(["d.json"]).top, null, "absent --top must be null");
assert.equal(parseArgs(["--top", "3", "d.json"]).top, 3);
assert.throws(() => parseArgs(["--top", "x", "d.json"]), /top/i, "a non-integer --top must be refused by name");
assert.throws(() => parseArgs(["--top", "0", "d.json"]), /top/i, "--top 0 must be refused");

// 2. the limit is its own function in compute, applied AFTER the sort
assert.equal(typeof topN, "function", "compute.js must export topN");
const sorted = sortEntries(aggregate([
	{ owner: "a", amount: 1 }, { owner: "b", amount: 9 }, { owner: "c", amount: 5 },
]), "total");
assert.deepEqual(topN(sorted, 2), [{ owner: "b", total: 9 }, { owner: "c", total: 5 }]);
assert.deepEqual(topN(sorted, null), sorted, "a null limit keeps everything");
assert.deepEqual(topN(sorted, 99), sorted, "a limit past the end keeps everything");

// 3. the table still aligns to the WIDEST OWNER SHOWN, not the widest dropped
const narrow = formatTable(topN(sortEntries(aggregate([
	{ owner: "zz", amount: 9 }, { owner: "wide-owner-name", amount: 1 },
]), "total"), 1));
assert.ok(narrow.split("\n")[1].startsWith("zz  "), `the kept row must not be padded for a dropped one: ${JSON.stringify(narrow)}`);

// 4. end to end, through the real entry point
const out = run(["--sort", "total", "--top", "2", "data.json"]);
const rows = out.split("\n").slice(1);
assert.equal(rows.length, 2, `--top 2 must print two rows, got ${rows.length}`);
assert.ok(rows[0].startsWith("eli"), rows[0]);
assert.ok(rows[1].startsWith("cy"), rows[1]);

// 5. and the existing behaviour is untouched
assert.equal(run(["--sort", "total", "data.json"]).split("\n").length, 6, "no --top must print every owner");
console.log("pass");
