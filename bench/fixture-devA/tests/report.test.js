// The EXISTING behaviour tests. They must keep passing.
import { strict as assert } from "node:assert";
import { parseArgs } from "../src/parse.js";
import { aggregate, sortEntries } from "../src/compute.js";
import { formatTable } from "../src/format.js";

// Field by field, not a whole-object deepEqual: this file has to keep
// passing while the options object legitimately GAINS a field, and a
// deepEqual here would make a correct new option look like a regression.
{
	const o = parseArgs(["data.json"]);
	assert.equal(o.file, "data.json");
	assert.equal(o.sort, "name");
	assert.equal(o.json, false);
}
assert.deepEqual(parseArgs(["--sort", "total", "d.json"]).sort, "total");
assert.throws(() => parseArgs(["--nope", "d.json"]), /unknown option/);

const agg = aggregate([{ owner: "a", amount: 2 }, { owner: "b", amount: 1 }, { owner: "a", amount: 3 }]);
assert.deepEqual(sortEntries(agg, "name"), [{ owner: "a", total: 5 }, { owner: "b", total: 1 }]);
assert.deepEqual(sortEntries(agg, "total"), [{ owner: "a", total: 5 }, { owner: "b", total: 1 }]);

assert.ok(formatTable([{ owner: "ana", total: 45 }]).includes("ana"));
console.log("report tests ok");
