/**
 * The set builder — N instances per family, from one seed.
 *
 * WHO RUNS THIS AND WHEN: the owner holds the seed and runs this at the
 * freeze. The tuning side sees no instance before the scored legs are
 * archived. Everything here is a pure function of (seed, counts), so the
 * set can be rebuilt and audited by anyone holding both.
 *
 * SHAPES ARE DRAWN TO A QUOTA, NOT INDEPENDENTLY. Drawing each instance's
 * shape at random gave, in testing, one family-E shape four times in twelve
 * and another once, and one family-C shape three times in four. For a
 * demonstration that is noise; for a scored set it means a family's result
 * is dominated by whichever shape the seed happened to favour, and two
 * seeds would not be comparable. Each shape gets ceil(n/shapes) slots, the
 * slots are shuffled, and the remainder is drawn without replacement.
 *
 * THE WEIGHTS ARE THE REVIEW'S, not mine: no family above one third of the
 * instances; E and F together at least one third. They are asserted here
 * rather than trusted — a weighting that silently drifts is a set that
 * measures something other than what was ratified.
 */
import { rng } from "./rng.mjs";
import { generateA, verifierA } from "./family-a.mjs";
import { generateBD, verifierBD, SHAPE_COUNT as BD_SHAPES } from "./family-bd.mjs";
import { generateC, verifierC, SHAPE_COUNT as C_SHAPES } from "./family-c.mjs";
import { generateE, verifierE, SHAPE_COUNT as E_SHAPES } from "./family-e.mjs";
import { generateF, verifierF } from "./family-f.mjs";

const FAMILIES = {
	A:     { gen: generateA,  ver: verifierA,  favours: "ours, by history", shapes: 0 },
	"B+D": { gen: generateBD, ver: verifierBD, favours: "neither",          shapes: BD_SHAPES },
	C:     { gen: generateC,  ver: verifierC,  favours: "ours, by tuning",  shapes: C_SHAPES },
	E:     { gen: generateE,  ver: verifierE,  favours: "theirs, by design", shapes: E_SHAPES },
	F:     { gen: generateF,  ver: verifierF,  favours: "ours, by design",  shapes: 0 },
};

/** The ratified weighting, checked rather than assumed. */
export function checkWeights(counts) {
	const total = Object.values(counts).reduce((a, b) => a + b, 0);
	const problems = [];
	for (const [k, n] of Object.entries(counts)) {
		if (n < 5) problems.push(`${k} has ${n} instances; the ruling is at least 5 per family`);
		if (n > total / 3) problems.push(`${k} is ${n} of ${total}, above one third`);
	}
	const ef = (counts.E ?? 0) + (counts.F ?? 0);
	if (ef < total / 3) problems.push(`E+F are ${ef} of ${total}, below one third`);
	return problems;
}

/**
 * @param seed    the owner's seed. Nobody on the tuning side has it.
 * @param counts  instances per family, sized to the request cap AFTER the
 *                owner's cap decision — never chosen first.
 */
export function buildSet(seed, counts) {
	const problems = checkWeights(counts);
	if (problems.length) {
		// FAIL, do not warn. A set built outside the ratified weighting is
		// not the set that was ratified, and a warning in a log is not a
		// control.
		throw new Error(`the weighting is not the ratified one:\n  ${problems.join("\n  ")}`);
	}
	const out = [];
	for (const [family, spec] of Object.entries(FAMILIES)) {
		const n = counts[family] ?? 0;
		// one stream per family, keyed on the family name, so adding or
		// resizing one family does not reshuffle the others
		const g = rng(`${seed}::${family}`);
		// THE QUOTA, actually built rather than described. Each shape gets
		// ceil(n / shapes) slots; the slots are shuffled so the ORDER is
		// still the seed's, and the excess is trimmed. Without this a
		// family's result is dominated by whichever shape the seed happened
		// to favour, and two seeds are not comparable.
		let slots = null;
		if (spec.shapes > 0) {
			const per = Math.ceil(n / spec.shapes);
			const all = [];
			for (let s = 0; s < spec.shapes; s += 1) for (let k = 0; k < per; k += 1) all.push(s);
			slots = g.shuffle(all).slice(0, n);
		}
		for (let i = 0; i < n; i += 1) {
			const inst = spec.gen(rng(`${seed}::${family}::${i}`), slots ? { shape: slots[i] } : {});
			out.push({
				id: `${family}-${String(i + 1).padStart(3, "0")}`,
				family,
				favours: spec.favours,
				instance: inst,
				verifier: spec.ver(inst),
			});
		}
		void g;
	}
	return out;
}
