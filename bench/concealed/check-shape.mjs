/**
 * The shape's rules, checked from GENERATED instances — never from the
 * constants that are supposed to produce them.
 *
 *   ruling 2   no family above one third of instances; E + F together at
 *              least one third; at least 5 instances per family per arm
 *   design 5   the files a task REQUIRES reading are long in the corpus's
 *              proportion: the share over the 200-line default read window
 *              in [35%, 50%] against the measured 42.6%, the median and
 *              p90 within a factor of 1.5 of 158 and 1,516
 *
 * The rules must hold for WHATEVER seed the owner draws, so they are
 * checked over many throwaway seeds, never over one. The per-pass request
 * estimate is printed so the gate reconciles against the cap with a
 * number (lead, 2026-09-18); the cap is the owner's.
 */

import { generateAll, shapeHash } from "./generate.mjs";

export const READ_WINDOW = 200;
export const TRUNCATION_MEASURED = 0.426;
export const TRUNCATION_BAND = [0.35, 0.5];
export const MEDIAN_TARGET = 158;
export const P90_TARGET = 1516;
export const FACTOR = 1.5;
export const FLOOR_PER_FAMILY = 5;

function quantile(sorted, q) {
	if (sorted.length === 0) return 0;
	const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
	return sorted[i];
}

/** Evaluate the rules over `seeds`; `instancesFor` is injectable so a test
 *  can hand in a deliberately bad shape and watch each rule go red. */
export function checkShape(seeds, instancesFor = generateAll) {
	const perSeed = seeds.map((s) => instancesFor(s));
	const counts = {};
	for (const inst of perSeed[0]) counts[inst.family] = (counts[inst.family] ?? 0) + 1;
	const total = perSeed[0].length;
	const lengths = perSeed.flat().flatMap((i) => i.required.map((r) => r.lines)).sort((a, b) => a - b);
	const over = lengths.filter((n) => n > READ_WINDOW).length;
	const share = lengths.length === 0 ? 0 : over / lengths.length;
	const median = quantile(lengths, 0.5);
	const p90 = quantile(lengths, 0.9);
	const requests = perSeed.map((set) => set.reduce((n, i) => n + i.estRequests, 0));
	const perArm = Math.max(...requests);

	const violations = [];
	for (const [fam, n] of Object.entries(counts)) {
		if (n > total / 3) violations.push(`family ${fam} is ${n}/${total} of instances — above one third (ruling 2)`);
		if (n < FLOOR_PER_FAMILY) violations.push(`family ${fam} has ${n} instances — below the floor of ${FLOOR_PER_FAMILY} (ruling 2)`);
	}
	const ef = (counts.E ?? 0) + (counts.F ?? 0);
	if (ef < total / 3) violations.push(`E + F are ${ef}/${total} — below one third (ruling 2)`);
	if (share < TRUNCATION_BAND[0] || share > TRUNCATION_BAND[1]) violations.push(`${(share * 100).toFixed(1)}% of required files exceed ${READ_WINDOW} lines — outside [${TRUNCATION_BAND[0] * 100}%, ${TRUNCATION_BAND[1] * 100}%] (design 5)`);
	if (median < MEDIAN_TARGET / FACTOR || median > MEDIAN_TARGET * FACTOR) violations.push(`median required-file length ${median} is not within ×${FACTOR} of ${MEDIAN_TARGET} (design 5)`);
	if (p90 < P90_TARGET / FACTOR || p90 > P90_TARGET * FACTOR) violations.push(`p90 required-file length ${p90} is not within ×${FACTOR} of ${P90_TARGET} (design 5)`);

	return {
		shapeHash: shapeHash(),
		seeds: seeds.length,
		instancesPerArm: total,
		counts,
		weights: Object.fromEntries(Object.entries(counts).map(([f, n]) => [f, n / total])),
		eAndF: ef / total,
		requiredFiles: lengths.length,
		truncationShare: share,
		truncationMeasured: TRUNCATION_MEASURED,
		median,
		p90,
		requestsPerArmPerPass: perArm,
		requestsPerPassBothArms: perArm * 2,
		violations,
	};
}

/** Throwaway seeds for the check — never the owner's. */
export function checkSeeds(n = 40) {
	return Array.from({ length: n }, (_, i) => `check-shape-${i}`);
}
