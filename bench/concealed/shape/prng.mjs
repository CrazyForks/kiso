/**
 * The concealed set's ONE source of chance.
 *
 * Every draw the generator makes goes through a stream built here from
 * (seed, family, index), so an instance is a pure function of the shape and
 * those three values: the same seed materialises the same bytes on any
 * machine, and nothing — no clock, no Math.random, no directory order —
 * can make two runs of the same draw differ.
 *
 * xmur3 hashes the key string to a 32-bit state; mulberry32 is the stream.
 * Neither is cryptographic, and neither needs to be: the seed's secrecy is
 * custody (the owner holds it), not the generator's strength.
 */

function xmur3(text) {
	let h = 1779033703 ^ text.length;
	for (let i = 0; i < text.length; i += 1) {
		h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	h = Math.imul(h ^ (h >>> 16), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return (h ^= h >>> 16) >>> 0;
}

function mulberry32(state) {
	let a = state >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A stream of draws keyed by its parts, e.g. stream(seed, "A", 3, "names"). */
export function stream(...key) {
	const next = mulberry32(xmur3(key.map(String).join("/")));
	const rng = {
		/** uniform in [0, 1) */
		next,
		/** an integer in [lo, hi], both inclusive */
		int(lo, hi) {
			return lo + Math.floor(next() * (hi - lo + 1));
		},
		/** one element */
		pick(list) {
			if (list.length === 0) throw new Error("pick from an empty list");
			return list[Math.floor(next() * list.length)];
		},
		/** a shuffled copy (Fisher–Yates) */
		shuffle(list) {
			const out = [...list];
			for (let i = out.length - 1; i > 0; i -= 1) {
				const j = Math.floor(next() * (i + 1));
				[out[i], out[j]] = [out[j], out[i]];
			}
			return out;
		},
		/** k distinct elements, in draw order */
		sample(list, k) {
			return rng.shuffle(list).slice(0, k);
		},
		/** a standard normal (Box–Muller; one draw per call, the pair's twin discarded) */
		normal() {
			const u = Math.max(next(), 1e-12);
			const v = next();
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		},
	};
	return rng;
}

/**
 * A file length, in lines, from the corpus the design pins "realistic" to:
 * the 96 real sessions on the owner's machine — median 158, p90 1,516.
 * A log-normal through those two points: mu = ln 158, sigma =
 * ln(1516/158) / z(0.90). Clamped to [40, 4000]: below 40 there is no room
 * for the work, and above 4,000 a single fixture costs more to materialise
 * than it tells us.
 */
export const LENGTH_MEDIAN = 158;
export const LENGTH_P90 = 1516;
const Z90 = 1.2815515655446004;
export const LENGTH_MU = Math.log(LENGTH_MEDIAN);
export const LENGTH_SIGMA = Math.log(LENGTH_P90 / LENGTH_MEDIAN) / Z90;
export const LENGTH_MIN = 40;
export const LENGTH_MAX = 4000;

export function drawLength(rng) {
	const x = Math.exp(LENGTH_MU + LENGTH_SIGMA * rng.normal());
	return Math.max(LENGTH_MIN, Math.min(LENGTH_MAX, Math.round(x)));
}
