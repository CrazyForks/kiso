#!/usr/bin/env node
/**
 * The concealed set's command line (bench/concealed/README.md).
 *
 *   shape-hash
 *   check-shape [--seeds N]
 *   list
 *   materialize --seed S --instance ID --out DIR
 *   verify --instance-dir DIR --workspace WS [--answer FILE] [--out DIR]
 *   self-check --seed S            every instance: fixture fails, reference
 *                                  passes, B+D's compensation fails on B+D-3
 *
 * THE REAL SEED IS NEVER TYPED HERE BY THE TUNING SIDE. The owner draws it
 * at the freeze and it is handed to `materialize` inside the runner, at run
 * time. Tests use throwaway seeds only.
 */

import { checkSeeds, checkShape } from "./check-shape.mjs";
import { generateInstance, instanceIds, shapeHash } from "./generate.mjs";
import { materialize } from "./materialize.mjs";
import { verify } from "./verify.mjs";
import { selfCheck } from "./self-check.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function flags(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
		const v = argv[i + 1];
		if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
		out[a.slice(2)] = v;
		i += 1;
	}
	return out;
}

function need(f, key) {
	if (f[key] === undefined) throw new Error(`--${key} is required`);
	return f[key];
}

function main(argv) {
	const [cmd, ...rest] = argv;
	const f = flags(rest);
	switch (cmd) {
		case "shape-hash":
			console.log(shapeHash());
			return 0;
		case "check-shape": {
			const r = checkShape(checkSeeds(f.seeds !== undefined ? Number(f.seeds) : undefined));
			console.log(`shape ${r.shapeHash}`);
			console.log(`instances per arm: ${r.instancesPerArm} over ${r.seeds} throwaway seeds`);
			for (const [fam, n] of Object.entries(r.counts)) console.log(`  ${fam.padEnd(3)} ${String(n).padStart(2)}  ${(r.weights[fam] * 100).toFixed(1)}%`);
			console.log(`E + F: ${(r.eAndF * 100).toFixed(1)}% (ruling 2: at least one third)`);
			console.log(`required files: ${r.requiredFiles}; over 200 lines: ${(r.truncationShare * 100).toFixed(1)}% (measured corpus: ${(r.truncationMeasured * 100).toFixed(1)}%)`);
			console.log(`required-file length: median ${r.median} (corpus 158), p90 ${r.p90} (corpus 1,516)`);
			console.log(`estimated requests per pass: ${r.requestsPerArmPerPass} per arm, ${r.requestsPerPassBothArms} for both — the cap is the owner's`);
			if (r.violations.length > 0) {
				for (const v of r.violations) console.log(`VIOLATION ${v}`);
				return 1;
			}
			console.log("the shape's rules hold");
			return 0;
		}
		case "list":
			for (const id of instanceIds()) console.log(id);
			return 0;
		case "materialize": {
			const meta = materialize(generateInstance(need(f, "seed"), need(f, "instance")), need(f, "out"));
			console.log(`${meta.id} (${meta.family}, favours ${meta.favours}) → ${f.out}`);
			return 0;
		}
		case "verify": {
			const r = verify({
				instanceDir: need(f, "instance-dir"),
				workspace: need(f, "workspace"),
				...(f.answer !== undefined ? { answerFile: f.answer } : {}),
				...(f.out !== undefined ? { outDir: f.out } : {}),
			});
			// the one-word contract the runner reads, on stdout alone; the
			// per-assertion detail goes to stderr for a human and verify.json
			for (const g of r.gates) console.error(`${g.pass ? "ok  " : "FAIL"} ${g.class} ${g.id} — ${g.detail}${g.cite ? `  [turn ${g.cite.turn}: "${g.cite.clause}"]` : ""}`);
			console.log(r.verdict);
			return 0;
		}
		case "self-check": {
			// verdicts and assertion ids only — never instance content, so the
			// ceremony can run it on the real seed
			let bad = 0;
			for (const id of instanceIds()) {
				const dir = mkdtempSync(join(tmpdir(), "kiso-concealed-mat-"));
				try {
					materialize(generateInstance(need(f, "seed"), id), dir);
					const r = selfCheck(dir);
					if (!r.ok) bad += 1;
					console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id}${r.ok ? "" : ` — ${r.problems.join("; ")}`}`);
				} finally {
					rmSync(dir, { recursive: true, force: true });
				}
			}
			console.log(bad === 0 ? "every instance's verifier is proven" : `${bad} instance(s) have a verifier that is not proven`);
			return bad === 0 ? 0 : 1;
		}
		default:
			console.error("usage: cli.mjs shape-hash | check-shape [--seeds N] | list | materialize --seed S --instance ID --out DIR | verify --instance-dir DIR --workspace WS [--answer FILE] [--out DIR]");
			return 2;
	}
}

try {
	process.exitCode = main(process.argv.slice(2));
} catch (err) {
	console.error(`concealed: ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 2;
}
