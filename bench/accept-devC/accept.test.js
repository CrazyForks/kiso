// HIDDEN ACCEPTANCE for task C — written before the round.
// A constrained refactor: the same validation block is copied into three
// modules. It must become one, with NO behaviour change. Both halves are
// scored — a refactor that changes what the code does is not this task, and
// a refactor that leaves the copies is not one either.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loaderRead, loaderCount } from "../src/loader.js";
import { exporterRead } from "../src/exporter.js";
import { importerRead } from "../src/importer.js";

// ── 1. BEHAVIOUR IS UNCHANGED, on every entry point, message for message ──
const dir = mkdtempSync(join(tmpdir(), "devC-acc-"));
const w = (n, v) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(v)); return p; };
for (const [name, read] of [["loader", loaderRead], ["exporter", exporterRead], ["importer", importerRead]]) {
	assert.equal(read(w("ok.json", [{ owner: "a", amount: 1 }])).length, 1, name);
	assert.throws(() => read(w("a.json", {})), /expected an array of records/, name);
	assert.throws(() => read(w("b.json", [null])), /record 0 is not an object/, name);
	assert.throws(() => read(w("c.json", [{ amount: 1 }])), /record 0 has no owner/, name);
	assert.throws(() => read(w("d.json", [{ owner: "", amount: 1 }])), /record 0 has no owner/, name);
	assert.throws(() => read(w("e.json", [{ owner: "a", amount: "x" }])), /record 0 has a non-numeric amount/, name);
	assert.throws(() => read(w("f.json", [{ owner: "a", amount: -1 }])), /record 0 has a negative amount/, name);
	// the INDEX in the message is the record's own, not always zero
	assert.throws(() => read(w("g.json", [{ owner: "a", amount: 1 }, { owner: "b", amount: -2 }])), /record 1 has a negative amount/, name);
}
assert.equal(loaderCount(w("h.json", [{ owner: "a", amount: 1 }, { owner: "b", amount: 2 }])), 2);

// ── 2. THE DUPLICATION IS GONE ────────────────────────────────────────────
// Counted structurally, not by eye: the distinctive message strings must
// each appear ONCE across src/, and the three modules must be shorter than
// the copies they started as.
const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = readdirSync(src).filter((f) => f.endsWith(".js"));
const text = Object.fromEntries(files.map((f) => [f, readFileSync(join(src, f), "utf8")]));
for (const needle of ["expected an array of records", "is not an object", "has no owner", "has a non-numeric amount", "has a negative amount"]) {
	const n = files.filter((f) => text[f].includes(needle)).length;
	assert.equal(n, 1, `"${needle}" still lives in ${n} files; the validation must exist once`);
}
console.log("pass");
