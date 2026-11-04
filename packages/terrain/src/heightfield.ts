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

/** The normal that a write of the normal map reuses, so a whole ground costs no object per texel. */
const NORMAL = [0, 0, 0];

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
	 * Writes the ground's normals into a square image of `resolution` texels along each side, row
	 * by row from `z = -size / 2` upward, as four bytes per texel: the normal's x and z, each from
	 * -1 to 1 as 0 to 255, then two bytes that hold no value. A surface rebuilds the y from the
	 * unit length. The slope is read with the same central differences as `normalAt`, so every
	 * block of every level shades from one picture of the ground rather than from its own
	 * vertices. Allocates nothing beyond what the caller gives.
	 */
	writeNormalMap(resolution: number, data: Uint8Array): void {
		if (!Number.isInteger(resolution) || resolution < 1)
			throw new Error(
				`writeNormalMap() got the resolution ${resolution}, which is not a whole number of 1 or more.`,
			);
		if (data.length !== resolution * resolution * 4)
			throw new Error(
				`writeNormalMap() got ${data.length} bytes, but ${resolution} texels along each side need ${resolution * resolution * 4}.`,
			);
		const { corner, size } = this;
		const span = size / resolution;
		const out = NORMAL;
		let at = 0;
		for (let row = 0; row < resolution; row++) {
			const z = corner + (row + 0.5) * span;
			for (let col = 0; col < resolution; col++) {
				this.normalAt(corner + (col + 0.5) * span, z, out);
				data[at] = Math.round(((out[0] as number) * 0.5 + 0.5) * 255);
				data[at + 1] = Math.round(((out[2] as number) * 0.5 + 0.5) * 255);
				data[at + 2] = 128;
				data[at + 3] = 255;
				at += 4;
			}
		}
	}

	/**
	 * The distance along a ray from (`ox`, `oy`, `oz`) in the unit direction (`dx`, `dy`, `dz`)
	 * to where it first meets the ground within the square, or -1 when it meets none within
	 * `maxDistance`. The ground is the surface that `heightAt` gives: in each cell between four
	 * samples it is the bilinear patch, along which a ray's height above the ground is a quadratic,
	 * so each cell's crossing is exact. The ray walks the cells that it crosses, nearest first. A
	 * ray that starts under the ground meets it at 0. Allocates nothing.
	 */
	raycast(
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
		maxDistance: number,
	): number {
		const { step, corner, resolution, heights } = this;
		// The ray in samples from the low corner, so a cell is one unit along each side.
		const fx = (ox - corner) / step;
		const fz = (oz - corner) / step;
		const ux = dx / step;
		const uz = dz / step;
		const cells = resolution - 1;
		// Clip the ray to the square: where it enters and leaves it.
		let enter = 0;
		let leave = maxDistance;
		if (ux === 0) {
			if (fx < 0 || fx > cells) return -1;
		} else {
			const a = (0 - fx) / ux;
			const b = (cells - fx) / ux;
			enter = Math.max(enter, Math.min(a, b));
			leave = Math.min(leave, Math.max(a, b));
		}
		if (uz === 0) {
			if (fz < 0 || fz > cells) return -1;
		} else {
			const a = (0 - fz) / uz;
			const b = (cells - fz) / uz;
			enter = Math.max(enter, Math.min(a, b));
			leave = Math.min(leave, Math.max(a, b));
		}
		if (!(enter <= leave)) return -1;
		// The cell where the ray enters the square, and the distances to its next column and row.
		const last = cells - 1;
		const ex = fx + ux * enter;
		const ez = fz + uz * enter;
		let cx = Math.min(Math.max(Math.floor(ex), 0), last);
		let cz = Math.min(Math.max(Math.floor(ez), 0), last);
		const stepX = ux > 0 ? 1 : -1;
		const stepZ = uz > 0 ? 1 : -1;
		const spanX = ux === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ux);
		const spanZ = uz === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / uz);
		let nextX = ux === 0 ? Number.POSITIVE_INFINITY : ((ux > 0 ? cx + 1 : cx) - fx) / ux;
		let nextZ = uz === 0 ? Number.POSITIVE_INFINITY : ((uz > 0 ? cz + 1 : cz) - fz) / uz;
		let from = enter;
		for (;;) {
			const to = Math.min(nextX, nextZ, leave);
			const a = heights[cz * resolution + cx] as number;
			const b = heights[cz * resolution + cx + 1] as number;
			const c = heights[(cz + 1) * resolution + cx] as number;
			const d = heights[(cz + 1) * resolution + cx + 1] as number;
			// The patch h(u, v) = a + k1 u + k2 v + k3 u v, with u and v the place in the cell.
			const k1 = b - a;
			const k2 = c - a;
			const k3 = a - b - c + d;
			const u0 = fx - cx;
			const v0 = fz - cz;
			// The ray's height above the patch, f(t) = q t^2 + p t + r, at a distance t.
			const q = -k3 * ux * uz;
			const p = dy - (k1 * ux + k2 * uz + k3 * (u0 * uz + v0 * ux));
			const r = oy - (a + k1 * u0 + k2 * v0 + k3 * u0 * v0);
			const hit = firstRoot(q, p, r, from, to);
			if (hit >= 0) return hit;
			if (to >= leave) return -1;
			if (nextX < nextZ) {
				cx += stepX;
				nextX += spanX;
			} else {
				cz += stepZ;
				nextZ += spanZ;
			}
			if (cx < 0 || cx > last || cz < 0 || cz > last) return -1;
			from = to;
		}
	}
}

/**
 * The first distance from `from` to `to` where `q t^2 + p t + r` reaches 0 or below, from above,
 * or -1 when it stays above. A ray that starts under the ground meets it where it starts.
 */
function firstRoot(q: number, p: number, r: number, from: number, to: number): number {
	const start = (q * from + p) * from + r;
	if (start <= 0) return from;
	const end = (q * to + p) * to + r;
	if (q === 0) {
		if (end > 0) return -1;
		return -r / p;
	}
	// The quadratic's lowest point inside the span can dip under the ground with both ends above.
	const discriminant = p * p - 4 * q * r;
	if (discriminant < 0) return -1;
	const root = Math.sqrt(discriminant);
	// The two roots, computed so that neither loses digits to a near cancellation.
	const k = -0.5 * (p + (p >= 0 ? root : -root));
	const t1 = k / q;
	const t2 = k === 0 ? t1 : r / k;
	const low = Math.min(t1, t2);
	const high = Math.max(t1, t2);
	if (low >= from && low <= to) return low;
	if (high >= from && high <= to) return high;
	return -1;
}

/**
 * Makes a height field. See `Heightfield`.
 *
 * @category api/terrain
 */
export function createHeightfield(options: HeightfieldOptions): Heightfield {
	return new Heightfield(options);
}
