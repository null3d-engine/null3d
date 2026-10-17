// A height field: the height of a square piece of ground, sampled once into a flat array and read
// back with bilinear interpolation. Every part of the terrain reads its height from here, so a
// mesh, the sampler that places objects and the shadow of a hill all agree.

/**
 * Options for `createHeightfield`.
 *
 * @category api/terrain
 */
export interface HeightfieldOptions {
	/** The width and depth of the square, in meters, centered on the origin. */
	size: number;
	/**
	 * The samples along each side, from 2 up. The default is 256. A function's height is read
	 * once at each sample; a typed array must hold `resolution * resolution` heights already.
	 */
	resolution?: number;
	/**
	 * The height of the ground at a point, in meters. A function is read once per sample. A
	 * `Float32Array` holds the samples row by row, from `z = -size / 2` upward, sampled with
	 * `resolution` heights per row.
	 */
	height: ((x: number, z: number) => number) | Float32Array;
}

/**
 * The offsets of a vertex and of the four points around it that a normal reads, in samples along x
 * then along z: the vertex itself, then one sample each way across and along.
 */
const AROUND_OFFSETS = new Int32Array([0, 0, 1, 0, -1, 0, 0, 1, 0, -1]);

/** The heights of those five points, which a write of a block reuses. */
const AROUND = new Float64Array(5);

/**
 * The height field that a terrain builds every block from: the height of a square piece of ground,
 * sampled once and read back with bilinear interpolation.
 *
 * @category api/terrain
 */
export class Heightfield {
	/** The width and depth of the square, in meters. */
	readonly size: number;
	/** The samples along each side. */
	readonly resolution: number;
	/** The lowest sample of the ground, in meters. */
	readonly min: number;
	/** The highest sample of the ground, in meters. */
	readonly max: number;
	/** The samples of the ground, row by row, from `z = -size / 2` upward. */
	readonly heights: Float32Array;
	/** The meters between two samples. */
	private readonly step: number;
	/** The x and z of the first sample, at the square's low corner. */
	private readonly corner: number;

	constructor(options: HeightfieldOptions) {
		const { size, height } = options;
		const resolution = options.resolution ?? 256;
		if (!(size > 0) || !Number.isFinite(size))
			throw new Error(`createHeightfield() got the size ${size}, which is not a positive number.`);
		if (!Number.isInteger(resolution) || resolution < 2)
			throw new Error(
				`createHeightfield() got the resolution ${resolution}, which is not a whole number of 2 or more.`,
			);
		this.size = size;
		this.resolution = resolution;
		this.step = size / (resolution - 1);
		this.corner = -size / 2;
		const samples = resolution * resolution;
		const heights = typeof height === 'function' ? new Float32Array(samples) : height;
		if (heights.length !== samples)
			throw new Error(
				`createHeightfield() got ${heights.length} heights, but a resolution of ${resolution} needs ${samples}.`,
			);
		if (typeof height === 'function') {
			const { step, corner } = this;
			for (let row = 0; row < resolution; row++)
				for (let col = 0; col < resolution; col++)
					heights[row * resolution + col] = height(corner + col * step, corner + row * step);
		}
		this.heights = heights;
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < samples; i++) {
			const y = heights[i] as number;
			if (y < min) min = y;
			if (y > max) max = y;
		}
		this.min = min;
		this.max = max;
	}

	/**
	 * The sample at the column `col` and the row `row`, clamped to the square, so a reader just
	 * outside the ground gets the edge's height. An index below 0 or past the resolution takes the
	 * nearest edge's sample.
	 */
	sample(col: number, row: number): number {
		const { resolution, heights } = this;
		const c = col < 0 ? 0 : col >= resolution ? resolution - 1 : col;
		const r = row < 0 ? 0 : row >= resolution ? resolution - 1 : row;
		return heights[r * resolution + c] as number;
	}

	/**
	 * The height of the ground at a point, in meters. A point between samples takes the bilinear
	 * interpolation of the four around it, and a point outside the square takes the edge's height.
	 * Allocates nothing.
	 */
	heightAt(x: number, z: number): number {
		const { step, corner, resolution } = this;
		const fx = (x - corner) / step;
		const fz = (z - corner) / step;
		const cx = Math.min(Math.max(Math.floor(fx), 0), resolution - 2);
		const cz = Math.min(Math.max(Math.floor(fz), 0), resolution - 2);
		const tx = Math.min(Math.max(fx - cx, 0), 1);
		const tz = Math.min(Math.max(fz - cz, 0), 1);
		const a = this.sample(cx, cz);
		const b = this.sample(cx + 1, cz);
		const c = this.sample(cx, cz + 1);
		const d = this.sample(cx + 1, cz + 1);
		const top = a + (b - a) * tx;
		const bottom = c + (d - c) * tx;
		return top + (bottom - top) * tz;
	}

	/**
	 * The size of the ground's slope at a point, as the rise over the run: 0 on flat ground and
	 * about 1 at a 45 degree slope. Reads the field around the point, so it costs four
	 * `heightAt` calls. Allocates nothing.
	 */
	slopeAt(x: number, z: number): number {
		const d = this.step;
		const dx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
		const dz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
		return Math.sqrt(dx * dx + dz * dz) / (2 * d);
	}

	/**
	 * The unit normal of the ground at a point, written into `out` as x, y and z. Reads the field
	 * around the point, so it costs four `heightAt` calls. Allocates nothing.
	 */
	normalAt(x: number, z: number, out: number[] | Float32Array): void {
		const d = this.step;
		const dx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
		const dz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
		// The length by hand: `Math.hypot` makes one object per call.
		const length = Math.sqrt(dx * dx + 1 + dz * dz);
		out[0] = -dx / length;
		out[1] = 1 / length;
		out[2] = -dz / length;
	}

	/**
	 * Writes the heights and normals of a grid of `quads` faces along each side into `positions` and
	 * `normals`, three numbers per vertex, for a block whose low corner stands at the world point
	 * (`originX`, `originZ`). Each height is the field's at that world point and each normal the
	 * ground's slope there, as `heightAt` and `normalAt` give them, and both arrays carry the
	 * block's own coordinates from that corner. A builder of a mesh reads a whole grid in one call,
	 * so its loop crosses no call per vertex: a call carries a fraction as an object of its own
	 * wherever the browser does not inline it. Allocates nothing.
	 */
	writeGridVertices(
		blockSize: number,
		originX: number,
		originZ: number,
		quads: number,
		positions: Float32Array,
		normals: Float32Array,
	): void {
		const { resolution, heights, step, corner } = this;
		const cell = blockSize / quads;
		const last = resolution - 2;
		const around = AROUND;
		const offsets = AROUND_OFFSETS;
		let at = 0;
		for (let row = 0; row <= quads; row++)
			for (let col = 0; col <= quads; col++, at += 3) {
				const x = col * cell;
				const z = row * cell;
				const fx = (originX + x - corner) / step;
				const fz = (originZ + z - corner) / step;
				// The vertex, then the four points one sample each way from it, whose heights give the
				// slope. Reading them in this loop keeps the arithmetic of the whole block in one place.
				for (let k = 0; k < 5; k++) {
					const gx = fx + (offsets[k * 2] as number);
					const gz = fz + (offsets[k * 2 + 1] as number);
					const cx = Math.min(Math.max(Math.floor(gx), 0), last);
					const cz = Math.min(Math.max(Math.floor(gz), 0), last);
					const tx = Math.min(Math.max(gx - cx, 0), 1);
					const tz = Math.min(Math.max(gz - cz, 0), 1);
					const a = heights[cz * resolution + cx] as number;
					const b = heights[cz * resolution + cx + 1] as number;
					const c = heights[(cz + 1) * resolution + cx] as number;
					const d = heights[(cz + 1) * resolution + cx + 1] as number;
					const top = a + (b - a) * tx;
					const bottom = c + (d - c) * tx;
					around[k] = top + (bottom - top) * tz;
				}
				positions[at] = x;
				positions[at + 1] = around[0] as number;
				positions[at + 2] = z;
				// The rise over the run a sample each way, made one unit long. The length is the square
				// root of the squares, because `Math.hypot` of three numbers makes an object of its own.
				const dx = ((around[1] as number) - (around[2] as number)) / (2 * step);
				const dz = ((around[3] as number) - (around[4] as number)) / (2 * step);
				const length = Math.sqrt(dx * dx + 1 + dz * dz);
				normals[at] = -dx / length;
				normals[at + 1] = 1 / length;
				normals[at + 2] = -dz / length;
			}
	}
}

/**
 * Makes a height field. See `Heightfield`.
 *
 * @category api/terrain
 */
export function createHeightfield(options: HeightfieldOptions): Heightfield {
	return new Heightfield(options);
}
