#!/usr/bin/env node
/**
 * The concealed set's command line (bench/concealed/README.md).
 *
 *   shape-hash
 *   check-shape [--seeds N]
 *   list
 *   materialize --seed S --instance ID --out DIR
 *   verify --instance-dir DIR --workspace WS [--answer FILE] [--out DIR]
 *   apparatus-hash
 *   check-shape --seed S           ONE drawn seed's figures (the G6 ceremony)
 *   self-check --seed S [--verbose yes]
 *                                  every instance: fixture fails, reference
 *                                  passes, each negative control fails on
 *                                  the gate it names
 *
 * THE REAL SEED IS NEVER TYPED HERE BY THE TUNING SIDE. The owner draws it
 * at the freeze and it is handed to `materialize` inside the runner, at run
 * time. Tests use throwaway seeds only.
 */

import { checkSeed, checkSeeds, checkShape } from "./check-shape.mjs";
import { apparatusHash, generateInstance, instanceIds, shapeHash } from "./generate.mjs";
import { materialize } from "./materialize.mjs";
import { verify } from "./verify.mjs";
import { selfCheck } from "./self-check.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The flags each subcommand takes — anything else is refused (review S3):
 *  a flag silently ignored is a flag somebody believed was honoured. */
const ALLOWED = {
	"shape-hash": [],
	"apparatus-hash": [],
	"check-shape": ["seeds", "seed"],
	list: [],
	materialize: ["seed", "instance", "out"],
	verify: ["instance-dir", "workspace", "answer", "out"],
	"self-check": ["seed", "verbose"],
};

function flags(cmd, argv) {
	const allowed = ALLOWED[cmd] ?? [];
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
		const v = argv[i + 1];
		if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
		if (!allowed.includes(a.slice(2))) throw new Error(`${cmd}: unknown flag ${a}`);
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
	const f = flags(cmd, rest);
	switch (cmd) {
		case "shape-hash":
			console.log(shapeHash());
			return 0;
		case "apparatus-hash":
			console.log(apparatusHash());
			return 0;
		case "check-shape": {
			if (f.seed !== undefined) {
				// ONE drawn seed (G6): counts and length figures, never content
				const r = checkSeed(f.seed);
				console.log(`shape ${r.shapeHash}`);
				console.log(`apparatus ${r.apparatusHash}`);
				console.log(`this seed: ${Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(", ")}`);
				console.log(`required files: ${r.requiredFiles}; over 200 lines: ${(r.truncationShare * 100).toFixed(1)}% (band 35%–50%)`);
				console.log(`required-file length: median ${r.median}, p90 ${r.p90}`);
				console.log(`estimated requests: ${r.requestsPerArm} per arm`);
				console.log(r.inBand ? "IN BAND" : "OUT OF BAND — the pre-registered rule: redraw once, record both draws");
				return r.inBand ? 0 : 1;
			}
			const r = checkShape(checkSeeds(f.seeds !== undefined ? Number(f.seeds) : undefined));
			console.log(`shape ${r.shapeHash}`);
			console.log(`instances per arm: ${r.instancesPerArm} over ${r.seeds} throwaway seeds`);
			for (const [fam, n] of Object.entries(r.counts)) console.log(`  ${fam.padEnd(3)} ${String(n).padStart(2)}  ${(r.weights[fam] * 100).toFixed(1)}%`);
			console.log(`E + F: ${(r.eAndF * 100).toFixed(1)}% (ruling 2: at least one third)`);
			console.log(`required files: ${r.requiredFiles}; over 200 lines: ${(r.truncationShare * 100).toFixed(1)}% (measured corpus: ${(r.truncationMeasured * 100).toFixed(1)}%)`);
			console.log(`required-file length: median ${r.median} (corpus 158), p90 ${r.p90} (corpus 1,516)`);
			console.log(`estimated requests per pass: ${r.requestsPerArmPerPass} per arm, ${r.requestsPerPassBothArms} for both — the cap is the owner's`);
			console.log(`B+D is SMALL, and says so: ${r.bd.functions} functions, ${r.bd.triples} (function, kind, location) triples, ${r.bd.prompts} distinct prompts (+${r.bd.testFixtures} test-location fixtures) — its concealment rests on custody`);
			console.log(`apparatus ${r.apparatusHash}`);
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
					const r = selfCheck(dir, { verbose: f.verbose === "yes" });
					if (!r.ok) bad += 1;
					// problems name gate TYPES and counts only (G5); ids — which
					// carry drawn names — appear only under --verbose yes, which the
					// ceremony never passes
					console.log(`${r.ok ? "ok  " : "FAIL"} ${r.id}${r.ok ? "" : ` — ${r.problems.join("; ")}`}`);
					if (r.detail !== undefined && r.detail.length > 0) console.log(`     ${r.detail.join(", ")}`);
				} finally {
					rmSync(dir, { recursive: true, force: true });
				}
			}
			console.log(bad === 0 ? "every instance's verifier is proven" : `${bad} instance(s) have a verifier that is not proven`);
			return bad === 0 ? 0 : 1;
		}
		default:
			console.error("usage: cli.mjs shape-hash | apparatus-hash | check-shape [--seeds N | --seed S] | list | materialize --seed S --instance ID --out DIR | verify --instance-dir DIR --workspace WS [--answer FILE] [--out DIR] | self-check --seed S [--verbose yes]");
			return 2;
	}
}

try {
	process.exitCode = main(process.argv.slice(2));
} catch (err) {
	console.error(`concealed: ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 2;
}
