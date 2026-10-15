// Seeded random numbers for emitters. Each particle's numbers come from a hash of its system's seed
// and its own number, so a system emits the same particles whatever the frame rate, and a held frame
// is the same on every machine. The hash is PCG's, as the particle shaders hash seeds. The numbers
// go through typed arrays, never as results, so a call allocates nothing.

/** The places of `randomize`'s whole numbers: the system's seed, the particle's number, its seed. */
export const SYSTEM_SEED = 0;
export const NUMBER = 1;
export const PARTICLE_SEED = 2;

/**
 * Writes the seed of particle `seeds[NUMBER]` of the system whose seed is `seeds[SYSTEM_SEED]` at
 * `seeds[PARTICLE_SEED]`, and fills `out` with that particle's numbers from 0 up to 1, one for each
 * channel.
 */
export function randomize(seeds: Uint32Array, out: Float64Array): void {
	let state =
		(Math.imul(((seeds[SYSTEM_SEED] as number) ^ (seeds[NUMBER] as number)) >>> 0, 747796405) +
			2891336453) >>>
		0;
	let word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	const seed = ((word >>> 22) ^ word) >>> 0;
	seeds[PARTICLE_SEED] = seed;
	for (let c = 0; c < out.length; c++) {
		state = (Math.imul((seed ^ Math.imul(c, 2654435769)) >>> 0, 747796405) + 2891336453) >>> 0;
		word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
		out[c] = (((word >>> 22) ^ word) >>> 8) / 16777216;
	}
}

/** The PCG hash of a 32-bit value, for seeds that the systems make once. */
export function pcg(value: number): number {
	const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}
