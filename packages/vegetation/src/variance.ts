// The variance maps: type, color and lichen at one to two meters, so neighboring plants differ a
// little and the ground gains patches. Each map's lattice values come from the integer hash, so the
// patches lie in the same place on every device.
import { Grid } from './grid';
import { hashAt } from './hash';

/** The default meters between two lattice values. */
const DEFAULT_CELL = 1.5;

/**
 * The options for `varianceMaps`.
 *
 * @category api/vegetation
 */
export interface VarianceOptions {
	/** The scene's seed. */
	readonly seed: number;
	/** The width and depth of the square, in meters, centered on the origin. */
	readonly size: number;
	/** The meters between two lattice values, from 1 to 2 by default. */
	readonly cell?: number;
}

/**
 * The patches that vary a scatter at one to two meters: the type, which picks a species' variant,
 * the color, which shifts a plant's tint, and the lichen, which covers a plant or a stone.
 *
 * @category api/vegetation
 */
export class VarianceMaps extends Grid {
	/** The type at each lattice point, from 0 to 1. */
	readonly type: Float32Array;
	/** The color shift at each lattice point, from -1 to 1. */
	readonly color: Float32Array;
	/** The lichen coverage at each lattice point, from 0 to 1. */
	readonly lichen: Float32Array;

	constructor(options: VarianceOptions) {
		const cell = options.cell ?? DEFAULT_CELL;
		if (!(cell > 0) || !Number.isFinite(cell))
			throw new Error(`varianceMaps() got the cell ${cell}, which is not a positive number.`);
		super(options.size, Math.max(2, Math.round(options.size / cell) + 1));
		const points = this.resolution * this.resolution;
		this.type = new Float32Array(points);
		this.color = new Float32Array(points);
		this.lichen = new Float32Array(points);
		const { seed } = options;
		for (let row = 0; row < this.resolution; row++)
			for (let col = 0; col < this.resolution; col++) {
				const at = row * this.resolution + col;
				this.type[at] = hashAt(seed, 0x7469, col, row) / 4294967296;
				this.color[at] = (hashAt(seed, 0x636f, col, row) / 4294967296) * 2 - 1;
				this.lichen[at] = hashAt(seed, 0x6c69, col, row) / 4294967296;
			}
	}

	/** The type at a point, from 0 to 1. */
	typeAt(x: number, z: number): number {
		return this.sampleAt(this.type, x, z);
	}

	/** The color shift at a point, from -1 to 1. */
	colorAt(x: number, z: number): number {
		return this.sampleAt(this.color, x, z);
	}

	/** The lichen coverage at a point, from 0 to 1. */
	lichenAt(x: number, z: number): number {
		return this.sampleAt(this.lichen, x, z);
	}
}

/**
 * Makes the variance maps that vary a scatter's type, color and lichen.
 *
 * @param options The seed and the square.
 * @returns The three maps.
 * @category api/vegetation
 */
export function varianceMaps(options: VarianceOptions): VarianceMaps {
	if (!(options.size > 0) || !Number.isFinite(options.size))
		throw new Error(`varianceMaps() got the size ${options.size}, which is not a positive number.`);
	return new VarianceMaps(options);
}
