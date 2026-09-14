import { strict as assert } from "node:assert";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loaderRead, loaderCount } from "../src/loader.js";
import { exporterRead } from "../src/exporter.js";
import { importerRead } from "../src/importer.js";

const dir = mkdtempSync(join(tmpdir(), "devC-"));
const w = (name, v) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };

for (const read of [loaderRead, exporterRead, importerRead]) {
	assert.equal(read(w("ok.json", [{ owner: "a", amount: 1 }])).length, 1);
	assert.throws(() => read(w("a.json", {})), /expected an array/);
	assert.throws(() => read(w("b.json", [null])), /not an object/);
	assert.throws(() => read(w("c.json", [{ amount: 1 }])), /no owner/);
	assert.throws(() => read(w("d.json", [{ owner: "a", amount: "x" }])), /non-numeric/);
	assert.throws(() => read(w("e.json", [{ owner: "a", amount: -1 }])), /negative/);
}
assert.equal(loaderCount(w("f.json", [{ owner: "a", amount: 1 }, { owner: "b", amount: 2 }])), 2);
console.log("records tests ok");
