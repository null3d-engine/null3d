// A square grid of values over a piece of ground, read at any point with bilinear interpolation.
// The ground maps and the variance maps both build on it, so a page reads either one the same way.

/**
 * A square of ground with one value at each sample of a grid.
 *
 * @category api/vegetation
 */
export class Grid {
	/** The width and depth of the square, in meters. */
	readonly size: number;
	/** The samples along each side. */
	readonly resolution: number;
	/** The meters between two samples. */
	readonly cell: number;
	/** The x of the first sample, at the square's low corner. */
	readonly originX: number;
	/** The z of the first sample, at the square's low corner. */
	readonly originZ: number;

	constructor(size: number, resolution: number) {
		if (!(size > 0) || !Number.isFinite(size))
			throw new Error(`a grid needs a size that is a positive number of meters, and got ${size}.`);
		if (!Number.isInteger(resolution) || resolution < 2)
			throw new Error(
				`a grid needs a resolution that is a whole number of 2 or more, and got ${resolution}.`,
			);
		this.size = size;
		this.resolution = resolution;
		this.cell = size / (resolution - 1);
		this.originX = -size / 2;
		this.originZ = -size / 2;
	}

	/** The index of the nearest sample to a point. */
	indexAt(x: number, z: number): number {
		const { resolution, cell, originX, originZ } = this;
		const column = Math.min(Math.max(Math.round((x - originX) / cell), 0), resolution - 1);
		const row = Math.min(Math.max(Math.round((z - originZ) / cell), 0), resolution - 1);
		return row * resolution + column;
	}

	/** The sample's x for a column. */
	xAt(column: number): number {
		return this.originX + column * this.cell;
	}

	/** The sample's z for a row. */
	zAt(row: number): number {
		return this.originZ + row * this.cell;
	}

	/**
	 * One grid's value at a point, read with bilinear interpolation. Allocates nothing, so a
	 * placement rule reads it for every candidate that it scores.
	 */
	sampleAt(grid: Float32Array, x: number, z: number): number {
		const { resolution, cell, originX, originZ } = this;
		const fx = (x - originX) / cell;
		const fz = (z - originZ) / cell;
		const column = Math.min(Math.max(Math.floor(fx), 0), resolution - 2);
		const row = Math.min(Math.max(Math.floor(fz), 0), resolution - 2);
		const tx = Math.min(Math.max(fx - column, 0), 1);
		const tz = Math.min(Math.max(fz - row, 0), 1);
		const at = row * resolution + column;
		const a = grid[at] as number;
		const b = grid[at + 1] as number;
		const c = grid[at + resolution] as number;
		const d = grid[at + resolution + 1] as number;
		const top = a + (b - a) * tx;
		const bottom = c + (d - c) * tx;
		return top + (bottom - top) * tz;
	}
}
