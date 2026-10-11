// Seeded random numbers for emitters. Each particle's numbers come from a hash of its system's seed
// and its own number, so a system emits the same particles whatever the frame rate, and a held frame
// is the same on every machine.

/** The PCG hash of a 32-bit value, as the particle shaders hash seeds. */
export function pcg(value: number): number {
	const state = (Math.imul(value >>> 0, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

/** A number from 0 up to 1 for a seed and a channel: one of a particle's independent numbers. */
export function chance(seed: number, channel: number): number {
	return (pcg((seed ^ Math.imul(channel, 2654435769)) >>> 0) >>> 8) / 16777216;
}

/** A number from `range[0]` up to `range[1]` for a seed and a channel. */
export function between(range: readonly [number, number], seed: number, channel: number): number {
	return range[0] + (range[1] - range[0]) * chance(seed, channel);
}
