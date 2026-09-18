/**
 * (shape, seed) → the concealed set.
 *
 * An instance is a pure function of the shape (every file under shape/),
 * the seed, its family and its index — its own stream, so drawing more of
 * one family never shifts another's draws.
 *
 * The SHAPE HASH is sha256 over the shape files' names and bytes in sorted
 * order. It is committed and pinned by a test before any seed exists
 * (review ruling 4): a shape that changes after the pin is red.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAMILIES, PER_FAMILY } from "./shape/families.mjs";
import { stream } from "./shape/prng.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHAPE_DIR = join(HERE, "shape");

export function shapeHash() {
	const h = createHash("sha256");
	for (const f of readdirSync(SHAPE_DIR).filter((n) => n.endsWith(".mjs")).sort()) {
		h.update(`${f}\0`);
		h.update(readFileSync(join(SHAPE_DIR, f)));
		h.update("\0");
	}
	return h.digest("hex");
}

/**
 * The APPARATUS HASH (review G4): sha256 over every non-test .mjs under
 * bench/concealed OUTSIDE shape/ — the verifier, the generator's driver,
 * materialize, self-check, check-shape, the CLI. The shape hash says what
 * is drawn; this one says how it is judged, and the verifier's semantics
 * must not move under a pinned shape either.
 */
export function apparatusHash() {
	const h = createHash("sha256");
	for (const f of readdirSync(HERE).filter((n) => n.endsWith(".mjs")).sort()) {
		h.update(`${f}\0`);
		h.update(readFileSync(join(HERE, f)));
		h.update("\0");
	}
	return h.digest("hex");
}

/** The instance list for a seed: ids and family, in a fixed order. */
export function instanceIds() {
	const ids = [];
	for (const fam of Object.keys(FAMILIES)) for (let i = 1; i <= PER_FAMILY[fam]; i += 1) ids.push(`${fam}-${i}`);
	return ids;
}

/** One instance, by id ("A-3", "BD-1", …). */
export function generateInstance(seed, id) {
	const m = /^([A-Z]+)-(\d+)$/.exec(id);
	if (m === null || !(m[1] in FAMILIES)) throw new Error(`unknown instance id: ${id}`);
	const [, fam, n] = m;
	if (Number(n) < 1 || Number(n) > PER_FAMILY[fam]) throw new Error(`instance out of range: ${id}`);
	const inst = FAMILIES[fam](stream(seed, fam, n));
	return { id, shapeHash: shapeHash(), apparatusHash: apparatusHash(), ...inst };
}

export function generateAll(seed) {
	return instanceIds().map((id) => generateInstance(seed, id));
}
