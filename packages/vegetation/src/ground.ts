// The ground maps: the height and the normal of the ground read once into flat grids, so every
// placement rule reads the same slope, water, flow and mask numbers. A scatter costs one pass over
// the ground, never one terrain query for each plant it places.
import { Grid } from './grid';

/**
 * The height of the ground at a point, in meters, and optionally its normal.
 *
 * @category api/vegetation
 */
export interface GroundSampler {
	/** The ground's height at a world point. */
	heightAt(x: number, z: number): number;
	/** Writes the unit normal of the ground at a point into `out` as x, y and z. */
	normalAt?(x: number, z: number, out: Float32Array): void;
}

/**
 * The ground that a scatter reads: a terrain, which answers both a height and a normal, or a plain
 * height function, whose normals the maps work out from its samples.
 *
 * @category api/vegetation
 */
export type GroundSource = GroundSampler | ((x: number, z: number) => number);

/**
 * A shape that masks part of the ground, as a path, a rock or a cave mouth does.
 *
 * @category api/vegetation
 */
export type GroundShape =
	| {
			/** A disc. */
			readonly kind: 'circle';
			/** The middle's x. */
			readonly x: number;
			/** The middle's z. */
			readonly z: number;
			/** The disc's radius, in meters. */
			readonly radius: number;
	  }
	| {
			/** A strip along a straight line. */
			readonly kind: 'line';
			/** The start's x. */
			readonly ax: number;
			/** The start's z. */
			readonly az: number;
			/** The end's x. */
			readonly bx: number;
			/** The end's z. */
			readonly bz: number;
			/** The strip's width, in meters. */
			readonly width: number;
	  };

/**
 * A mask over the ground: a function that answers the share of a point that it covers, from 0 to 1,
 * or a list of shapes whose coverage is the highest of any shape.
 *
 * @category api/vegetation
 */
export type GroundMask = ((x: number, z: number) => number) | readonly GroundShape[];

/**
 * The options for `groundMaps`.
 *
 * @category api/vegetation
 */
export interface GroundOptions {
	/** The width and depth of the square of ground, in meters, centered on the origin. */
	readonly size: number;
	/** The height of the water's surface, in meters. The default is 0. */
	readonly water?: number;
	/** The samples along each side. The default is one a meter, from 32 to 512. */
	readonly resolution?: number;
	/** The ground's height, its normal, or both. */
	readonly height: GroundSource;
	/** Where the paths run, which no plant grows on. */
	readonly paths?: GroundMask;
	/** Where the rocks stand, which no plant grows on. */
	readonly rocks?: GroundMask;
	/** Where the cave mouths open, which no plant grows on. */
	readonly caves?: GroundMask;
	/** The curvature that reads as a full hollow, in 1/m. The default is 0.3. */
	readonly hollow?: number;
}

/** The default water level, in meters. */
const DEFAULT_WATER = 0;

/** The default curvature that reads as a full hollow, in 1/m. */
const DEFAULT_HOLLOW = 0.3;

/** The lowest resolution that the maps build at, along each side. */
const MIN_RESOLUTION = 32;

/** The highest resolution that the maps build at, along each side. */
const MAX_RESOLUTION = 512;

/** The vertical size under which the ground counts as flat, in meters per meter. */
const FLAT = 1e-6;

/** The sample count that the maps build at for a square of a given size. */
function resolutionFor(size: number, resolution: number | undefined): number {
	if (resolution !== undefined) {
		if (!Number.isInteger(resolution) || resolution < 2)
			throw new Error(
				`groundMaps() got the resolution ${resolution}, which is not a whole number of 2 or more.`,
			);
		return resolution;
	}
	// One sample a meter, which reads every hill and still keeps a large valley cheap.
	return Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, Math.round(size) + 1));
}

/** The coverage of one shape at a point. */
function shapeAt(shape: GroundShape, x: number, z: number): number {
	if (shape.kind === 'circle') {
		const dx = x - shape.x;
		const dz = z - shape.z;
		return dx * dx + dz * dz <= shape.radius * shape.radius ? 1 : 0;
	}
	const ex = shape.bx - shape.ax;
	const ez = shape.bz - shape.az;
	const length = ex * ex + ez * ez;
	const along = length > 0 ? ((x - shape.ax) * ex + (z - shape.az) * ez) / length : 0;
	const t = along < 0 ? 0 : along > 1 ? 1 : along;
	const dx = x - (shape.ax + ex * t);
	const dz = z - (shape.az + ez * t);
	const half = shape.width * 0.5;
	return dx * dx + dz * dz <= half * half ? 1 : 0;
}

/**
 * The share of a point that a mask covers, from 0 to 1. Answers 0 for a mask that a page leaves out.
 *
 * @param mask The mask, or nothing.
 * @param x The point's x.
 * @param z The point's z.
 * @returns The covered share.
 * @category api/vegetation
 */
export function maskValue(mask: GroundMask | undefined, x: number, z: number): number {
	if (!mask) return 0;
	if (typeof mask === 'function') {
		const value = mask(x, z);
		return value > 0 ? (value < 1 ? value : 1) : 0;
	}
	let cover = 0;
	for (const shape of mask) cover = Math.max(cover, shapeAt(shape, x, z));
	return cover;
}

/**
 * The ground read once into flat grids: its height, how high it stands above the water, how far it
 * lies from the water, its slope, its aspect, its curvature, the water that flows over it and the
 * shares that paths, rocks and cave mouths cover. A placement rule reads these grids and never asks
 * the terrain again.
 *
 * @category api/vegetation
 */
export class GroundMaps extends Grid {
	/** The height of the water's surface, in meters. */
	readonly water: number;
	/** The ground's height, in meters. */
	readonly height: Float32Array;
	/** How far the ground stands above the water, in meters. Negative under the water. */
	readonly aboveWater: Float32Array;
	/** The distance to the nearest ground at or under the water, in meters. */
	readonly distanceToWater: Float32Array;
	/** The rise over the run, which is 0 on flat ground and 1 at a 45 degree slope. */
	readonly slope: Float32Array;
	/** The compass direction that the slope faces, in degrees clockwise from north, where north is -z. */
	readonly aspect: Float32Array;
	/** How far the slope faces north, from -1 south to 1 north. 0 on flat ground. */
	readonly northness: Float32Array;
	/** How far the slope faces east, from -1 west to 1 east. 0 on flat ground. */
	readonly eastness: Float32Array;
	/** The hollows of the ground, positive in a dip and negative on a ridge, in 1/m. */
	readonly curvature: Float32Array;
	/** The water that gathers at a point, from 0 to 1. */
	readonly wetness: Float32Array;
	/** The share of a point that the paths cover, from 0 to 1. */
	readonly path: Float32Array;
	/** The share of a point that the rocks cover, from 0 to 1. */
	readonly rock: Float32Array;
	/** The share of a point that the cave mouths cover, from 0 to 1. */
	readonly cave: Float32Array;
	/** The highest of the three masks: the share that no plant takes. */
	readonly blocked: Float32Array;

	private readonly normals: Float32Array;
	private readonly flow: Float32Array;

	constructor(options: GroundOptions) {
		const { size } = options;
		super(size, resolutionFor(size, options.resolution));
		this.water = options.water ?? DEFAULT_WATER;
		const samples = this.resolution * this.resolution;
		this.height = new Float32Array(samples);
		this.aboveWater = new Float32Array(samples);
		this.distanceToWater = new Float32Array(samples);
		this.slope = new Float32Array(samples);
		this.aspect = new Float32Array(samples);
		this.northness = new Float32Array(samples);
		this.eastness = new Float32Array(samples);
		this.curvature = new Float32Array(samples);
		this.wetness = new Float32Array(samples);
		this.path = new Float32Array(samples);
		this.rock = new Float32Array(samples);
		this.cave = new Float32Array(samples);
		this.blocked = new Float32Array(samples);
		this.normals = new Float32Array(samples * 3);
		this.flow = new Float32Array(samples);

		const { height } = options;
		const sampler = typeof height === 'function' ? undefined : height;
		const readHeight =
			typeof height === 'function' ? height : (x: number, z: number) => height.heightAt(x, z);
		this.readHeights(readHeight);
		this.readNormals(sampler);
		this.readSlopeAspect();
		this.readCurvature();
		this.readDistanceToWater();
		this.readFlow();
		this.readWetness(options.hollow ?? DEFAULT_HOLLOW);
		this.readMasks(options.paths, options.rocks, options.caves);
	}

	/** The ground's height at a point, read with bilinear interpolation. */
	heightAt(x: number, z: number): number {
		return this.sampleAt(this.height, x, z);
	}

	/** The unit normal of the ground at a point, written into `out` as x, y and z. */
	normalAt(x: number, z: number, out: Float32Array): void {
		const at = this.indexAt(x, z) * 3;
		out[0] = this.normals[at] as number;
		out[1] = this.normals[at + 1] as number;
		out[2] = this.normals[at + 2] as number;
	}

	/** Reads the ground's height at every sample. */
	private readHeights(read: (x: number, z: number) => number): void {
		const { resolution, height } = this;
		let at = 0;
		for (let row = 0; row < resolution; row++) {
			const z = this.zAt(row);
			for (let col = 0; col < resolution; col++, at++) {
				const h = read(this.xAt(col), z);
				height[at] = h;
				this.aboveWater[at] = h - this.water;
			}
		}
	}

	/** Reads the ground's normal at every sample, from the sampler or from the heights around it. */
	private readNormals(sampler: GroundSampler | undefined): void {
		const { resolution, cell, normals } = this;
		if (sampler?.normalAt) {
			const one = new Float32Array(3);
			let at = 0;
			for (let row = 0; row < resolution; row++) {
				const z = this.zAt(row);
				for (let col = 0; col < resolution; col++, at += 3) {
					sampler.normalAt(this.xAt(col), z, one);
					normals[at] = one[0] as number;
					normals[at + 1] = one[1] as number;
					normals[at + 2] = one[2] as number;
				}
			}
			return;
		}
		// A height function has no normal of its own, so the slope across each sample gives one.
		const { height } = this;
		const last = resolution - 1;
		for (let row = 0; row < resolution; row++)
			for (let col = 0; col < resolution; col++) {
				const left = height[row * resolution + (col > 0 ? col - 1 : col)] as number;
				const right = height[row * resolution + (col < last ? col + 1 : col)] as number;
				const back = height[(row > 0 ? row - 1 : row) * resolution + col] as number;
				const front = height[(row < last ? row + 1 : row) * resolution + col] as number;
				const dx = (right - left) / (col > 0 && col < last ? 2 : 1) / cell;
				const dz = (front - back) / (row > 0 && row < last ? 2 : 1) / cell;
				const length = Math.sqrt(dx * dx + 1 + dz * dz);
				const at = (row * resolution + col) * 3;
				normals[at] = -dx / length;
				normals[at + 1] = 1 / length;
				normals[at + 2] = -dz / length;
			}
	}

	/** Turns each normal into a slope and the direction that the slope faces. */
	private readSlopeAspect(): void {
		const { resolution, normals } = this;
		for (let at = 0, sample = 0; sample < resolution * resolution; sample++, at += 3) {
			const nx = normals[at] as number;
			const ny = normals[at + 1] as number;
			const nz = normals[at + 2] as number;
			const flat = nx * nx + nz * nz;
			this.slope[sample] = Math.sqrt(flat) / ny;
			if (flat < FLAT * FLAT) {
				// Flat ground faces nowhere, so a rule that wants a north face skips it.
				this.northness[sample] = 0;
				this.eastness[sample] = 0;
				this.aspect[sample] = 0;
				continue;
			}
			const reach = Math.sqrt(flat);
			const east = nx / reach;
			const north = -nz / reach;
			this.eastness[sample] = east;
			this.northness[sample] = north;
			const degrees = (Math.atan2(east, north) * 180) / Math.PI;
			this.aspect[sample] = degrees < 0 ? degrees + 360 : degrees;
		}
	}

	/** Reads the curvature: the height of a sample against the four around it. */
	private readCurvature(): void {
		const { resolution, cell, height } = this;
		const last = resolution - 1;
		const aside = 1 / (cell * cell);
		for (let row = 0; row < resolution; row++)
			for (let col = 0; col < resolution; col++) {
				const at = row * resolution + col;
				const left = height[row * resolution + (col > 0 ? col - 1 : col)] as number;
				const right = height[row * resolution + (col < last ? col + 1 : col)] as number;
				const back = height[(row > 0 ? row - 1 : row) * resolution + col] as number;
				const front = height[(row < last ? row + 1 : row) * resolution + col] as number;
				this.curvature[at] = (left + right + back + front - 4 * (height[at] as number)) * aside;
			}
	}

	/** Reads how far every sample lies from the nearest ground at or under the water. */
	private readDistanceToWater(): void {
		const { resolution, cell, distanceToWater, aboveWater } = this;
		const diagonal = cell * Math.SQRT2;
		const far = 1e9;
		for (let at = 0; at < resolution * resolution; at++)
			distanceToWater[at] = (aboveWater[at] as number) <= 0 ? 0 : far;
		// Two passes over the grid: each takes the shorter way past the samples it has already met.
		for (let row = 0; row < resolution; row++)
			for (let col = 0; col < resolution; col++) {
				const at = row * resolution + col;
				let best = distanceToWater[at] as number;
				if (col > 0) best = Math.min(best, (distanceToWater[at - 1] as number) + cell);
				if (row > 0) {
					best = Math.min(best, (distanceToWater[at - resolution] as number) + cell);
					if (col > 0)
						best = Math.min(best, (distanceToWater[at - resolution - 1] as number) + diagonal);
					if (col < resolution - 1)
						best = Math.min(best, (distanceToWater[at - resolution + 1] as number) + diagonal);
				}
				distanceToWater[at] = best;
			}
		for (let row = resolution - 1; row >= 0; row--)
			for (let col = resolution - 1; col >= 0; col--) {
				const at = row * resolution + col;
				let best = distanceToWater[at] as number;
				if (col < resolution - 1) best = Math.min(best, (distanceToWater[at + 1] as number) + cell);
				if (row < resolution - 1) {
					best = Math.min(best, (distanceToWater[at + resolution] as number) + cell);
					if (col < resolution - 1)
						best = Math.min(best, (distanceToWater[at + resolution + 1] as number) + diagonal);
					if (col > 0)
						best = Math.min(best, (distanceToWater[at + resolution - 1] as number) + diagonal);
				}
				distanceToWater[at] = best;
			}
	}

	/** Pours the water downhill: every sample gathers the ground that drains through it. */
	private readFlow(): void {
		const { resolution, height, flow } = this;
		const samples = resolution * resolution;
		flow.fill(1);
		// The samples from the highest down, so a sample gathers what already reached it.
		const order = new Uint32Array(samples);
		for (let at = 0; at < samples; at++) order[at] = at;
		const sorted = Array.from(order).sort((a, b) => {
			const difference = (height[b] as number) - (height[a] as number);
			return difference !== 0 ? difference : a - b;
		});
		for (const at of sorted) {
			const col = at % resolution;
			const row = (at - col) / resolution;
			const here = height[at] as number;
			let lowest = -1;
			let steepest = 0;
			for (let dr = -1; dr <= 1; dr++)
				for (let dc = -1; dc <= 1; dc++) {
					if (dr === 0 && dc === 0) continue;
					const nr = row + dr;
					const nc = col + dc;
					if (nr < 0 || nr >= resolution || nc < 0 || nc >= resolution) continue;
					const other = nr * resolution + nc;
					const drop = (here - (height[other] as number)) / (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
					// The steepest way down, with the lower sample winning a tie so no edge is left out.
					if (drop > steepest || (drop === steepest && drop > 0 && other < lowest)) {
						steepest = drop;
						lowest = other;
					}
				}
			if (lowest >= 0) flow[lowest] = (flow[lowest] as number) + (flow[at] as number);
		}
	}

	/** Reads the wetness from the water that gathers and the hollows of the ground. */
	private readWetness(hollow: number): void {
		const { flow, curvature, wetness } = this;
		const samples = flow.length;
		// The water gathers by a power law, so a few channels take most of it. The top twentieth
		// sets the scale, which leaves the rest of the ground dry and the channels wet.
		const roots = new Float32Array(samples);
		for (let at = 0; at < samples; at++) roots[at] = Math.sqrt(flow[at] as number);
		const sorted = Array.from(roots).sort((a, b) => a - b);
		const scale = (sorted[Math.min(samples - 1, Math.floor(samples * 0.95))] as number) || 1;
		const bend = hollow > 0 ? 1 / hollow : 1;
		for (let at = 0; at < samples; at++) {
			const gathering = Math.min(1, (roots[at] as number) / scale);
			const dip = Math.max(0, Math.min(1, (curvature[at] as number) * bend));
			const value = 0.65 * gathering + 0.35 * dip;
			wetness[at] = value > 1 ? 1 : value < 0 ? 0 : value;
		}
	}

	/** Reads the shares that the paths, the rocks and the cave mouths cover. */
	private readMasks(
		paths: GroundMask | undefined,
		rocks: GroundMask | undefined,
		caves: GroundMask | undefined,
	): void {
		const { resolution } = this;
		const list = [paths, rocks, caves] as const;
		for (let row = 0; row < resolution; row++) {
			const z = this.zAt(row);
			for (let col = 0; col < resolution; col++) {
				const x = this.xAt(col);
				const at = row * resolution + col;
				const path = maskValue(list[0], x, z);
				const rock = maskValue(list[1], x, z);
				const cave = maskValue(list[2], x, z);
				this.path[at] = path;
				this.rock[at] = rock;
				this.cave[at] = cave;
				this.blocked[at] = Math.max(path, rock, cave);
			}
		}
	}
}

/**
 * Reads the ground once into the maps that a scatter places plants by.
 *
 * @param options The square, the water's level, the ground's height and the masks.
 * @returns The ground's maps.
 * @category api/vegetation
 */
export function groundMaps(options: GroundOptions): GroundMaps {
	if (!(options.size > 0) || !Number.isFinite(options.size))
		throw new Error(`groundMaps() got the size ${options.size}, which is not a positive number.`);
	return new GroundMaps(options);
}
