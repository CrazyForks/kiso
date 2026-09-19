/**
 * The seeded stream. Every instance in the concealed set comes from here
 * and from nothing else.
 *
 * WHY IT MATTERS WHO CALLS THIS: the set exists so that the tuning side has
 * not seen what it is scored on, and the tuning side wrote the generator.
 * The split is that I define the SHAPE and never see an INSTANCE — which
 * only holds if the instances are a pure function of a seed I do not have.
 * So: no Math.random anywhere in this directory, no Date.now, no reading of
 * the clock or the filesystem into a choice. A generator that is not
 * deterministic in the seed alone cannot be audited by anyone, including by
 * the person who wrote it.
 *
 * xoshiro128** — small, well-distributed, and stdlib-free so the archive
 * can be replayed years from now without resolving a dependency.
 */
export function rng(seed) {
	// splitmix32 to spread a short human seed across the state
	let z = 0;
	for (const ch of String(seed)) z = (Math.imul(z ^ ch.charCodeAt(0), 0x9e3779b1) >>> 0);
	const s = new Uint32Array(4);
	for (let i = 0; i < 4; i += 1) {
		z = (z + 0x9e3779b9) >>> 0;
		let t = z;
		t = (Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0);
		t = (Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0);
		s[i] = (t ^ (t >>> 15)) >>> 0;
	}
	const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
	const next = () => {
		const r = (Math.imul(rotl((Math.imul(s[1], 5) >>> 0), 7), 9) >>> 0);
		const t = (s[1] << 9) >>> 0;
		s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t;
		s[3] = rotl(s[3], 11);
		return r >>> 0;
	};
	for (let i = 0; i < 16; i += 1) next();           // warm up
	const float = () => next() / 4294967296;
	return {
		int: (n) => Math.floor(float() * n),
		pick: (xs) => xs[Math.floor(float() * xs.length)],
		/** a shuffled COPY — the caller's array is never reordered under it */
		shuffle: (xs) => {
			const a = [...xs];
			for (let i = a.length - 1; i > 0; i -= 1) {
				const j = Math.floor(float() * (i + 1));
				[a[i], a[j]] = [a[j], a[i]];
			}
			return a;
		},
		/** k distinct members, in shuffled order */
		sample: (xs, k) => {
			const a = [...xs];
			const out = [];
			for (let i = 0; i < k && a.length; i += 1) out.push(a.splice(Math.floor(float() * a.length), 1)[0]);
			return out;
		},
		float,
	};
}
