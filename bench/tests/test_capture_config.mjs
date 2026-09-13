#!/usr/bin/env node
/**
 * The per-arm configuration manifest — §10.3 and amendment 4b.
 *
 * What is tested is the REFUSALS. A capture that guesses is worse than one
 * that fails: a manifest exists so a number can be attributed, and a
 * confident wrong attribution is how an arm gets credited with a version it
 * never ran (the defect PR C fixed in run-t5.sh's version probe, which this
 * file must not reintroduce one field over).
 */
import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asVersion, captureArm, digestOf, packageOf, probe } from "../capture-config.mjs";

const d = mkdtempSync(join(tmpdir(), "capcfg-"));
const bin = (name, body) => {
	const p = join(d, name);
	writeFileSync(p, body);
	chmodSync(p, 0o755);
	return p;
};
let pass = 0;
const it = (what, fn) => { fn(); console.log(`  ok  ${what}`); pass++; };

it("a version is taken from the ARTIFACT, not from any checkout", () => {
	const b = bin("good", "#!/bin/sh\necho 0.34.0\n");
	const m = captureArm({ tool: "kiso", command: [b] });
	assert.equal(m.version, "0.34.0");
	assert.equal(m.versionWhy, null);
});

it("a bin that FAILS while printing is not believed — the error is not a version", () => {
	const b = bin("bad", '#!/bin/sh\necho "error: unknown flag --version"\nexit 2\n');
	const m = captureArm({ tool: "pi", command: [b] });
	assert.equal(m.version, null);
	assert.match(m.versionWhy, /failed/);
});

it("a bin that answers a different question is recorded as unanswered", () => {
	const b = bin("chatty", '#!/bin/sh\necho "pi, the agent"\n');
	const m = captureArm({ tool: "pi", command: [b] });
	assert.equal(m.version, null);
	assert.match(m.versionWhy, /did not report/);
});

it("an unanswerable field carries its REASON, never a neighbour's value", () => {
	const m = captureArm({ tool: "claude", command: [join(d, "does-not-exist")] });
	assert.equal(m.executable, null);
	assert.match(m.executableWhy, /not on PATH/);
	assert.equal(m.entryDigest, null);
	assert.equal(m.package, null);
});

it("the ENTRY FILE is digested — which file ran, not which package tree", () => {
	const a = bin("same-name-a", "#!/bin/sh\necho 1.0.0\n");
	const b = bin("same-name-b", "#!/bin/sh\necho 1.0.0\n# different bytes\n");
	assert.notEqual(digestOf(a), digestOf(b));
	assert.match(digestOf(a), /^sha256-[0-9a-f]{64}$/);
	// and the record says what the digest does NOT cover
	const m = captureArm({ tool: "kiso", command: [a] });
	assert.match(m.entryDigestScope, /not the package/);
});

it("the effort key and the endpoint are RECORDED, not assumed (amendment 4b)", () => {
	const b = bin("ok", "#!/bin/sh\necho 2.0.0\n");
	const m = captureArm({
		tool: "kiso", command: [b], model: "deepseek-flash",
		endpoint: "https://api.deepseek.com", reasoning: { effort: "high", thinking: "enabled" },
	});
	assert.equal(JSON.parse(m.reasoning.specified).effort, "high");
	assert.equal(m.endpoint.specified, "https://api.deepseek.com");
	assert.equal(m.model.specified, "deepseek-flash");
	// nothing was observed in this capture, and the record says so rather
	// than presenting the specification as a measurement
	assert.equal(m.model.observed, null);
	assert.match(m.model.why, /not observed/);
});

it("an OBSERVED value that contradicts the specified one is kept beside it", () => {
	const b = bin("ok3", "#!/bin/sh\necho 2.0.0\n");
	const m = captureArm({
		tool: "kiso", command: [b], model: "deepseek-flash",
		observed: { model: "deepseek-v4-flash" },
	});
	assert.equal(m.model.specified, "deepseek-flash");
	assert.equal(m.model.observed, "deepseek-v4-flash");
	assert.equal(m.model.agrees, false);
	assert.match(m.model.why, /did not use what was specified/);
});

it("agreement is recorded as agreement, not as silence", () => {
	const b = bin("ok4", "#!/bin/sh\necho 2.0.0\n");
	const m = captureArm({ tool: "pi", command: [b], model: "x", observed: { model: "x" } });
	assert.equal(m.model.agrees, true);
});

it("the environment is recorded by NAME ONLY — a manifest never archives a credential", () => {
	const b = bin("ok2", "#!/bin/sh\necho 2.0.0\n");
	const m = captureArm({ tool: "kiso", command: [b], envNames: ["DEEPSEEK_API_KEY", "KISO_HOME"] });
	assert.deepEqual(m.envNames, ["DEEPSEEK_API_KEY", "KISO_HOME"]);
	assert.equal(JSON.stringify(m).includes("sk-"), false);
});

it("asVersion accepts a version and refuses prose", () => {
	assert.equal(asVersion("v1.2.3"), "1.2.3");
	assert.equal(asVersion("0.36.0"), "0.36.0");
	assert.equal(asVersion("error: unknown flag"), null);
	assert.equal(asVersion(""), null);
	assert.equal(asVersion(undefined), null);
});

it("probe never yields a value from a non-zero exit", () => {
	const b = bin("exit3", '#!/bin/sh\necho "0.1.0"\nexit 3\n');
	const r = probe(b, []);
	assert.equal(r.value, null);
	assert.match(r.why, /failed/);
});

console.log(`\n[capture-config] ${pass} assertions OK`);
