// The EXISTING behaviour tests. They must keep passing.
import { strict as assert } from "node:assert";
import { parseArgs } from "../src/parse.js";
import { aggregate, sortEntries } from "../src/compute.js";
import { formatTable } from "../src/format.js";

assert.deepEqual(parseArgs(["data.json"]), { file: "data.json", sort: "name", json: false, min: null });
assert.deepEqual(parseArgs(["--sort", "total", "d.json"]).sort, "total");
assert.throws(() => parseArgs(["--nope", "d.json"]), /unknown option/);

const agg = aggregate([{ owner: "a", amount: 2 }, { owner: "b", amount: 1 }, { owner: "a", amount: 3 }]);
assert.deepEqual(sortEntries(agg, "name"), [{ owner: "a", total: 5 }, { owner: "b", total: 1 }]);
assert.deepEqual(sortEntries(agg, "total"), [{ owner: "a", total: 5 }, { owner: "b", total: 1 }]);

assert.ok(formatTable([{ owner: "ana", total: 45 }]).includes("ana"));
console.log("report tests ok");
