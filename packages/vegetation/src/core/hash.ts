// The integer hash that every random choice of the generator comes from. It works with 32-bit
// integer arithmetic, so a plant grows the same way on every device, and it matches the shaders'
// `null3d::noise::pcg`, so a page can reproduce a choice in WGSL. No choice reads a clock, a
// floating-point noise or the order in which a worker happens to run.

/**
 * The permutation of one 32-bit value, with the same bits as the shaders' `pcg`.
 *
 * @param value The value to hash.
 * @returns The hashed value.
 * @category api/vegetation
 */
export function pcg(value: number): number {
	const state = (Math.imul(value, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

/**
 * The hash of a seed and up to four choice keys. The keys are mixed in order, so a choice names
 * the plant, the branch, the leaf and the value it picks with a key of its own.
 *
 * @param seed The plant's seed.
 * @param a The first key.
 * @param b The second key.
 * @param c The third key.
 * @param d The fourth key.
 * @returns A 32-bit hash.
 * @category api/vegetation
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
 * @param seed The plant's seed.
 * @param a The first key.
 * @param b The second key.
 * @param c The third key.
 * @param d The fourth key.
 * @returns A value in [0, 1).
 * @category api/vegetation
 */
export function unitAt(seed: number, a = 0, b = 0, c = 0, d = 0): number {
	return (hashAt(seed, a, b, c, d) >>> 8) / 16777216;
}

/**
 * The hash of a run of bytes, four at a time through `pcg`. Two runs that differ in any bit, or in
 * length, give different hashes in all but one case in four billion.
 *
 * @param bytes The bytes to hash.
 * @param seed A starting value, so one hash can run on over several arrays.
 * @returns A 32-bit hash.
 * @category api/vegetation
 */
export function hashBytes(bytes: Uint8Array, seed = 0): number {
	let hash = pcg((seed ^ bytes.length) >>> 0);
	const whole = bytes.length - (bytes.length % 4);
	for (let i = 0; i < whole; i += 4) {
		const word =
			((bytes[i] as number) |
				((bytes[i + 1] as number) << 8) |
				((bytes[i + 2] as number) << 16) |
				((bytes[i + 3] as number) << 24)) >>>
			0;
		hash = pcg((hash ^ word) >>> 0);
	}
	for (let i = whole; i < bytes.length; i++) hash = pcg((hash ^ (bytes[i] as number)) >>> 0);
	return hash;
}

/**
 * The hash of a text, from its UTF-16 code units, as eight hexadecimal digits. Two hashes with
 * different seeds make a 64-bit key, which the kit and variant keys use.
 *
 * @param text The text.
 * @returns A 64-bit hash as sixteen hexadecimal digits.
 * @category api/vegetation
 */
export function hashText(text: string): string {
	let a = pcg(text.length >>> 0);
	let b = pcg((a ^ 0x9e3779b9) >>> 0);
	for (let i = 0; i < text.length; i++) {
		const unit = text.charCodeAt(i);
		a = pcg((a ^ unit) >>> 0);
		b = pcg((b ^ unit ^ (i << 16)) >>> 0);
	}
	return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
