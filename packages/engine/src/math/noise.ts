// Seeded value noise for content made in code: heights, texture maps and scatter patterns. Its
// numbers come from a seeded generator and a table, never from the fraction of a large sine, so it
// gives the same values on every machine and the same seed draws the same content on every run.
import { generator } from './math';

/** The smooth fade between two lattice points, with zero first and second slopes at both ends. */
function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The number a fraction `t` of the way from `a` to `b`. */
function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Seeded value noise in two and three dimensions, from -1 to 1, and its octaves. The same seed
 * gives the same noise on every run and every machine. The plane noise can repeat after a whole
 * number of cells, so a texture made from it tiles. Every call allocates nothing.
 *
 * ```ts
 * const noise = new Noise(7);
 * const height = (x: number, z: number) => 40 * noise.fbm2(x * 0.004, z * 0.004, 5);
 * ```
 *
 * @category api/math
 */
export class Noise {
	private readonly perm = new Uint8Array(512);
	private readonly values = new Float32Array(256);

	/** Makes the noise of `seed`, a whole number. */
	constructor(seed: number) {
		const next = generator(seed);
		const order = new Uint8Array(256);
		for (let i = 0; i < 256; i++) order[i] = i;
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			const swap = order[i] as number;
			order[i] = order[j] as number;
			order[j] = swap;
		}
		for (let i = 0; i < 512; i++) this.perm[i] = order[i & 255] as number;
		for (let i = 0; i < 256; i++) this.values[i] = next() * 2 - 1;
	}

	/** The random value of a lattice point, from -1 to 1. */
	private lattice(x: number, y: number, z: number): number {
		const { perm } = this;
		return this.values[
			perm[(perm[(perm[x & 255] as number) + (y & 255)] as number) + (z & 255)] as number
		] as number;
	}

	/**
	 * Noise at a point of the plane, from -1 to 1. With a period, a whole number of cells, the noise
	 * repeats every `period` cells. The default is 256, after which it repeats anyway.
	 */
	value2(x: number, y: number, period = 256): number {
		const fx = Math.floor(x);
		const fy = Math.floor(y);
		const tx = fade(x - fx);
		const ty = fade(y - fy);
		const x0 = ((fx % period) + period) % period;
		const y0 = ((fy % period) + period) % period;
		const x1 = (x0 + 1) % period;
		const y1 = (y0 + 1) % period;
		return mix(
			mix(this.lattice(x0, y0, 0), this.lattice(x1, y0, 0), tx),
			mix(this.lattice(x0, y1, 0), this.lattice(x1, y1, 0), tx),
			ty,
		);
	}

	/** Noise at a point of space, from -1 to 1. */
	value3(x: number, y: number, z: number): number {
		const fx = Math.floor(x);
		const fy = Math.floor(y);
		const fz = Math.floor(z);
		const tx = fade(x - fx);
		const ty = fade(y - fy);
		const tz = fade(z - fz);
		const near = mix(
			mix(this.lattice(fx, fy, fz), this.lattice(fx + 1, fy, fz), tx),
			mix(this.lattice(fx, fy + 1, fz), this.lattice(fx + 1, fy + 1, fz), tx),
			ty,
		);
		const far = mix(
			mix(this.lattice(fx, fy, fz + 1), this.lattice(fx + 1, fy, fz + 1), tx),
			mix(this.lattice(fx, fy + 1, fz + 1), this.lattice(fx + 1, fy + 1, fz + 1), tx),
			ty,
		);
		return mix(near, far, tz);
	}

	/**
	 * Octaves of plane noise, each twice as fine and half as strong, from about -1 to 1. With a
	 * period, the sum repeats every `period` cells of the first octave, so a texture made from it
	 * tiles.
	 */
	fbm2(x: number, y: number, octaves: number, period = 256): number {
		let sum = 0;
		let amplitude = 0.5;
		let scale = 1;
		for (let o = 0; o < octaves; o++) {
			sum += amplitude * this.value2(x * scale, y * scale, period * scale);
			amplitude *= 0.5;
			scale *= 2;
		}
		return sum;
	}

	/** Octaves of space noise, each twice as fine and half as strong, from about -1 to 1. */
	fbm3(x: number, y: number, z: number, octaves: number): number {
		let sum = 0;
		let amplitude = 0.5;
		let scale = 1;
		for (let o = 0; o < octaves; o++) {
			sum += amplitude * this.value3(x * scale, y * scale, z * scale);
			amplitude *= 0.5;
			scale *= 2;
		}
		return sum;
	}
}
