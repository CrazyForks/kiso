// HIDDEN ACCEPTANCE for task B — written before the round.
// The fault: the column width is measured over every row READ, not over the
// rows actually PRINTED, so a filtered-out owner keeps padding a table it is
// no longer in. The symptom is three files from the cause.
import { strict as assert } from "node:assert";
import { run } from "../src/index.js";
import { formatTable } from "../src/format.js";

// 1. THE BUG IS GONE: the kept rows align to the widest KEPT owner
const out = run(["--sort", "total", "--min", "10", "data.json"]);
const [header, ...rows] = out.split("\n");
assert.equal(rows.length, 3, `--min 10 keeps three owners, got ${rows.length}`);
assert.ok(header.startsWith("owner  total"), `the header is padded for a dropped owner: ${JSON.stringify(header)}`);
for (const r of rows) assert.ok(!/ {4,}/.test(r.replace(/\s+\d+$/, "")), `a kept row is over-padded: ${JSON.stringify(r)}`);

// 2. and the WIDE case still aligns when the wide owner IS shown
const wide = run(["--sort", "total", "data.json"]);
assert.ok(wide.split("\n").some((l) => l.startsWith("a-very-long-owner-name")), "the long owner must still print unfiltered");
assert.ok(wide.split("\n")[0].startsWith("owner                   total"), `unfiltered, the header widens: ${JSON.stringify(wide.split("\n")[0])}`);

// 3. formatTable on its own is still a pure function of what it is GIVEN.
// The expectation is COMPUTED from the stated rule — minimum width 5, two
// spaces, totals right-aligned in 5 — because a hand-counted run of spaces
// in a test fails for its own reasons rather than for the product's.
const W = 5;
const only = formatTable([{ owner: "zz", total: 9 }]);
assert.equal(
	only.split("\n")[1],
	`${"zz".padEnd(W)}  ${String(9).padStart(W)}`,
	`formatTable padded for something it was not given: ${JSON.stringify(only)}`,
);

// 4. nothing else moved
assert.equal(run(["--sort", "total", "data.json"]).split("\n").length, 5);
assert.equal(run(["--sort", "name", "--min", "100", "data.json"]).split("\n").length, 1, "an empty result is the header alone");
console.log("pass");
