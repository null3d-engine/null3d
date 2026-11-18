// The integer hash that places the tufts and grows their blades. It works with 32-bit integer
// arithmetic, so the grass is the same on every device, and it matches the shaders'
// `null3d::noise::pcg`, so a page can reproduce a choice in WGSL. No choice reads a clock, a
// floating-point noise or the order in which a worker happens to run. The module imports nothing,
// so code that runs on the job workers without the engine, such as a plant generator, can take it
// from its own entry, `@null3d/grass/hash`.

/**
 * The permutation of one 32-bit value, with the same bits as the shaders' `pcg`.
 *
 * @param value The value to hash.
 * @returns The hashed value.
 * @category api/grass
 */
export function pcg(value: number): number {
	const state = (Math.imul(value, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

/**
 * The hash of a seed and up to four choice keys. The keys are mixed in order, so a choice names
 * the thing, its part and the value it picks with a key of its own.
 *
 * @param seed The seed.
 * @param a The first key.
 * @param b The second key.
 * @param c The third key.
 * @param d The fourth key.
 * @returns A 32-bit hash.
 * @category api/grass
 */
export function hashAt(seed: number, a = 0, b = 0, c = 0, d = 0): number {
	let hash = pcg(seed >>> 0);
	hash = pcg((hash ^ (a >>> 0)) >>> 0);
	hash = pcg((hash ^ (b >>> 0)) >>> 0);
	hash = pcg((hash ^ (c >>> 0)) >>> 0);
	hash = pcg((hash ^ (d >>> 0)) >>> 0);
	return hash;
}

/**
 * A choice between 0 and 1, from a seed and its keys. The top 24 bits of the hash make the value,
 * so every device gets the same fraction.
 *
 * @param seed The seed.
 * @param a The first key.
 * @param b The second key.
 * @param c The third key.
 * @param d The fourth key.
 * @returns A value in [0, 1).
 * @category api/grass
 */
export function unitAt(seed: number, a = 0, b = 0, c = 0, d = 0): number {
	return (hashAt(seed, a, b, c, d) >>> 8) / 16777216;
}
