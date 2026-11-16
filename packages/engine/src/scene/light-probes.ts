import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	LIGHT_PROBE_VALUE_COUNT,
	LIGHT_PROBE_VALUE_COUNTS,
	LIGHT_PROBE_VALUE_ENVIRONMENT_WEIGHT,
	LIGHT_PROBE_VALUE_INTENSITY,
	LIGHT_PROBE_VALUE_ORIGIN,
	LIGHT_PROBE_VALUE_SPACING,
} from '../generated/core';
import type { Environment, EnvironmentOptions } from './environment';
import { toHalfFloat } from './half-float';
import type { CoreMemory, ViewHolder } from './memory';
import type { QueryTarget, RaycastBatchHits } from './queries';
import type { Scene } from './scene';
import type { Texture, Textures } from './textures';

// Light probe grids: a three-dimensional grid of irradiance probes, each holding L1 spherical
// harmonics of the light that reaches its point (see `.dev/decisions/D-146-light-probe-grid.md`).
// Standard materials read the grid per pixel, four hardware-filtered reads each, to light a scene
// with the light that its own walls, ground and sky bounce back, which one scene-wide environment
// cannot show.
//
// This module holds the shape of the grid and the maths that the bake and the shaders share, so the
// CPU bake and the WGSL sampling agree. The renderer binds the packed texels as one RGBA16F 3D
// texture: four sub-volumes along Z, three that hold a probe's four RGB coefficients and one that
// holds its validity and its sky visibility, each with one padding slice at either end, so hardware
// trilinear filtering never blends across sub-volumes. The coefficient order is the shader's, which
// is three.js's own: L0, then L1 along y, along z and along x, four RGB coefficients in all.
//
// A probe's coefficients hold the light that its surroundings bounce back. They leave out the sky
// itself, which no longer has to bake: the fourth sub-volume holds how much sky the probe sees, and
// the shader weights that by the surface's tilt toward the sky and multiplies it by the live
// environment's light, so time of day needs no new bake. A probe that lies inside geometry cannot
// light anything, and its validity is 0, which keeps its light from leaking through the wall around
// it.

/** The sub-volumes of a probe's texture along Z: three of coefficients and one of its masks. */
export const PROBE_SUBVOLUMES = 4;

/** The texels along each side of a 3D texture that every device holds, as the core's limit. */
export const VOLUME_TEXELS = 256;

/** The probes along the least axis of a grid. */
export const FEWEST_PROBES = 2;
/**
 * The most probes along x, along y and along z. Along z the four sub-volumes and their padding
 * slices share one side of the 3D texture.
 */
export const MOST_PROBES: ProbeCounts = [
	VOLUME_TEXELS,
	VOLUME_TEXELS,
	Math.floor(VOLUME_TEXELS / PROBE_SUBVOLUMES) - 2,
];

/** The floats of one probe's four RGB coefficients. */
export const PROBE_FLOATS = 12;

/** The channels that a sample interpolates: twelve coefficients, the validity and the sky visibility. */
export const PROBE_CHANNELS = PROBE_FLOATS + 2;

/** The probes along each axis. */
export type ProbeCounts = [number, number, number];

/** Directions of a Fibonacci sphere, evenly spread: three numbers per direction. */
export function fibonacciDirections(count: number, out: Float32Array): void {
	// The golden angle spreads each point as far as it can from the one before, so even a small
	// count covers the sphere.
	const step = Math.PI * (3 - Math.sqrt(5));
	const offset = 2 / count;
	for (let i = 0; i < count; i++) {
		const y = i * offset - 1 + offset / 2;
		const r = Math.sqrt(Math.max(0, 1 - y * y));
		const phi = i * step;
		out[i * 3] = Math.cos(phi) * r;
		out[i * 3 + 1] = y;
		out[i * 3 + 2] = Math.sin(phi) * r;
	}
}

// The Ramamoorthi coefficients that turn a radiance expansion into irradiance, folded into the
// constants of the first four real spherical harmonics (0.282095 and 0.488603), so `l1Irradiance`
// does one multiply per coefficient. They are the shader's first four `sh_irradiance` terms.

/** The scale of the L0 coefficient: pi times 0.282095. */
const L0_SCALE = 0.886227;
/** The scale of each L1 coefficient: 2 times 2*pi/3 times 0.488603, so 2*0.511664. */
const L1_SCALE = 1.023328;

/**
 * The irradiance of a surface of unit normal `(x, y, z)` from the four RGB coefficients at `at` in
 * `coefficients`, in the shader's order (L0, then L1 along y, z and x), three numbers into `out`,
 * as the shader's first four `sh_irradiance` terms.
 */
export function l1Irradiance(
	coefficients: Float32Array,
	at: number,
	x: number,
	y: number,
	z: number,
	out: Float32Array,
): void {
	for (let c = 0; c < 3; c++)
		out[c] =
			(coefficients[at + c] as number) * L0_SCALE +
			L1_SCALE *
				((coefficients[at + 3 + c] as number) * y +
					(coefficients[at + 6 + c] as number) * z +
					(coefficients[at + 9 + c] as number) * x);
}

/**
 * The irradiance that a grid of `counts` probes gives a surface at world position `(px, py, pz)`
 * with unit normal `(nx, ny, nz)`, as the shader reads it. `origin` and `spacing` place the grid,
 * `coefficients` holds four RGB coefficients per probe, `validity` and `skyVisibility` hold one
 * number per probe, and the sample point moves half a probe spacing along the normal, so light does
 * not leak across a wall. `work` holds at least 14 numbers, the interpolated channels. Writes four
 * numbers into `out`: the light of the coefficients, and the share of the environment's own light
 * that the sky gives, both weighted by the interpolated validity. The caller multiplies the
 * environment's irradiance by the latter, so the sky needs no bake. The share weights the
 * interpolated sky visibility by the surface's tilt toward the sky above the horizon, because the
 * visibility counts the whole sphere and the irradiance covers one hemisphere.
 */
export function sampleGrid(
	coefficients: Float32Array,
	validity: Float32Array,
	skyVisibility: Float32Array,
	counts: ProbeCounts,
	origin: ArrayLike<number>,
	spacing: ArrayLike<number>,
	px: number,
	py: number,
	pz: number,
	nx: number,
	ny: number,
	nz: number,
	work: Float32Array,
	out: Float32Array,
): void {
	// The sample point moves half a spacing along the normal, then clamps into the grid.
	const gx = clampGrid(
		(px - (origin[0] as number) + nx * (spacing[0] as number) * 0.5) / (spacing[0] as number),
		counts[0],
	);
	const gy = clampGrid(
		(py - (origin[1] as number) + ny * (spacing[1] as number) * 0.5) / (spacing[1] as number),
		counts[1],
	);
	const gz = clampGrid(
		(pz - (origin[2] as number) + nz * (spacing[2] as number) * 0.5) / (spacing[2] as number),
		counts[2],
	);
	const i0 = Math.floor(gx);
	const j0 = Math.floor(gy);
	const k0 = Math.floor(gz);
	const i1 = Math.min(i0 + 1, counts[0] - 1);
	const j1 = Math.min(j0 + 1, counts[1] - 1);
	const k1 = Math.min(k0 + 1, counts[2] - 1);
	const [fx, fy, fz] = [gx - i0, gy - j0, gz - k0];
	const at = (i: number, j: number, k: number) =>
		((k * counts[1] + j) * counts[0] + i) * PROBE_FLOATS;
	const where = (i: number, j: number, k: number) => (k * counts[1] + j) * counts[0] + i;
	// The eight probes' channels interpolate first: irradiance is linear in the coefficients, so
	// this gives the same light as interpolating its value at each of the eight.
	for (let c = 0; c < PROBE_CHANNELS; c++) {
		const read = (i: number, j: number, k: number) =>
			c < PROBE_FLOATS
				? (coefficients[at(i, j, k) + c] as number)
				: c === PROBE_FLOATS
					? (validity[where(i, j, k)] as number)
					: (skyVisibility[where(i, j, k)] as number);
		const x0 = mix(read(i0, j0, k0), read(i1, j0, k0), fx);
		const x1 = mix(read(i0, j1, k0), read(i1, j1, k0), fx);
		const x2 = mix(read(i0, j0, k1), read(i1, j0, k1), fx);
		const x3 = mix(read(i0, j1, k1), read(i1, j1, k1), fx);
		work[c] = mix(mix(x0, x1, fy), mix(x2, x3, fy), fz);
	}
	const valid = work[PROBE_FLOATS] as number;
	const sky = work[PROBE_FLOATS + 1] as number;
	l1Irradiance(work, 0, nx, ny, nz, out);
	for (let c = 0; c < 3; c++) out[c] = (out[c] as number) * valid;
	// The visibility counts the whole sphere and the environment's irradiance the hemisphere around
	// the normal, so a surface that faces a sky above the horizon takes twice the share. The weight
	// fades as the sky wraps around the probe.
	const tilt = Math.min(1, 2 * (1 - sky));
	// The shader saturates the whole product, not its factor: a surface facing an open sky takes
	// twice the visibility, which can exceed one before the clamp, and that is what keeps a probe
	// that sees half the sphere from giving half the light.
	const share = Math.min(1, Math.max(0, sky * (1 + ny * tilt)));
	out[3] = valid * share;
}

function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clampGrid(value: number, count: number): number {
	if (!(value > 0)) return 0;
	return value < count - 1 ? value : count - 1;
}

/** The texels of the packed grid along each axis: `width`, `height` and `depth`. */
export function gridTexels(counts: ProbeCounts): [number, number, number] {
	return [counts[0], counts[1], PROBE_SUBVOLUMES * (counts[2] + 2)];
}

/** The GPU bytes of a packed grid: 32 per probe, plus the padding slices. */
export function gridBytes(counts: ProbeCounts): number {
	const [w, h, d] = gridTexels(counts);
	return w * h * d * 8;
}

/**
 * Packs four RGB coefficients, a validity and a sky visibility per probe into the RGBA16F texels of
 * the grid's 3D texture: half floats in rows from the bottom up, slice after slice. The first texel
 * of a probe holds L0's red, green and blue and L1y's red, the first texel of the fourth sub-volume
 * holds the probe's validity and sky visibility, and the padding slices stay zero, so a filter
 * across one fades to no light instead of to a neighbour's coefficients.
 */
export function packProbes(
	counts: ProbeCounts,
	coefficients: Float32Array,
	validity: Float32Array,
	skyVisibility: Float32Array,
	texels: Uint16Array,
	toHalf: (value: number) => number,
): void {
	const [nx, ny, nz] = counts;
	const coefficientVolumes = PROBE_SUBVOLUMES - 1;
	for (let k = 0; k < nz; k++) {
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				const probe = (k * ny + j) * nx + i;
				const at = probe * PROBE_FLOATS;
				for (let s = 0; s < coefficientVolumes; s++) {
					const texel = ((s * (nz + 2) + 1 + k) * ny + j) * nx + i;
					for (let c = 0; c < 4; c++)
						texels[texel * 4 + c] = toHalf(coefficients[at + s * 4 + c] as number);
				}
				const mask = ((coefficientVolumes * (nz + 2) + 1 + k) * ny + j) * nx + i;
				texels[mask * 4] = toHalf(validity[probe] as number);
				texels[mask * 4 + 1] = toHalf(skyVisibility[probe] as number);
			}
		}
	}
}

/**
 * The options of `scene.setLightProbeGrid`: a grid of irradiance probes, baked by `bakeProbes`
 * or elsewhere. `LightProbeGridData` gives the texture and the grid's three-number values, which
 * pass in as they are.
 *
 * @category api/scene
 */
export interface LightProbeGridOptions {
	/** The 3D texture of the probes' coefficients, from `LightProbeGridData.toTexture`. */
	texture: Texture;
	/** The grid's corner of least x, y and z, in the world: three numbers. */
	origin: ArrayLike<number>;
	/** The distance between probes along each axis, in meters: three numbers. */
	spacing: ArrayLike<number>;
	/** The probes along each axis: three whole numbers. */
	counts: ArrayLike<number>;
	/**
	 * The factor of the grid's light on every surface. The default is 1. A factor of 0 lights
	 * nothing from the grid, and the grid still takes the share of the environment's light that
	 * `environmentWeight` names. A fade to 0 then gives no environment light back.
	 */
	intensity?: number;
	/**
	 * The share of the environment's diffuse light that the grid takes over, 0 to 1. The default
	 * is 1. The grid then gives a surface the light that its probes baked from their surroundings,
	 * plus the live environment's light times how much sky each probe sees, so the sky follows the
	 * hour without a new bake.
	 */
	environmentWeight?: number;
}

const CALL = 'setLightProbeGrid';

/** @internal The scene's light probe grid as the core holds it. */
export class SceneLightProbeGrid implements ViewHolder {
	private values: Float32Array | undefined;
	private generation = -1;

	constructor(private readonly core: CoreMemory) {
		core.holdViews(this);
	}

	/** Forgets the view of the block, which the next write makes again. */
	dropViews(): void {
		this.values = undefined;
	}

	/**
	 * Lights the scene with `grid`, or with none for null, from the next frame on. Throws E1203 for
	 * a number that is not finite, E1108 for a value out of range, E1213 for something that is not
	 * a texture, E1222 for a texture that is not a 3D texture, and E1101 for a texture that was
	 * destroyed.
	 */
	set(grid: LightProbeGridOptions | null): void {
		if (DEV) checkGrid(grid);
		const values = this.block();
		values.fill(0);
		if (grid) {
			const { origin, spacing, counts, intensity = 1, environmentWeight = 1 } = grid;
			for (let k = 0; k < 3; k++) {
				values[LIGHT_PROBE_VALUE_ORIGIN + k] = origin[k] as number;
				values[LIGHT_PROBE_VALUE_SPACING + k] = spacing[k] as number;
				values[LIGHT_PROBE_VALUE_COUNTS + k] = counts[k] as number;
			}
			values[LIGHT_PROBE_VALUE_INTENSITY] = intensity;
			values[LIGHT_PROBE_VALUE_ENVIRONMENT_WEIGHT] = environmentWeight;
		}
		const status = this.core.glue.setLightProbeGrid(grid ? grid.texture.handle : 0);
		this.core.check(status, CALL, 'a light probe grid', true);
	}

	/** The core's block of values, through a view made again after the memory grew. */
	private block(): Float32Array {
		const { core } = this;
		if (!this.values || this.generation !== core.generation) {
			this.values = core.f32(core.glue.lightProbeValues(), LIGHT_PROBE_VALUE_COUNT);
			this.generation = core.generation;
		}
		return this.values;
	}
}

/** Throws the errors that `SceneLightProbeGrid.set` names. Call it inside `if (DEV)`. */
function checkGrid(grid: LightProbeGridOptions | null): void {
	if (grid === null) return;
	if (typeof grid.texture !== 'object' || grid.texture === null)
		throw new EngineError(
			'E1213',
			`${CALL}() got ${String(grid.texture)} for texture, which takes a texture from textures.fromData().`,
		);
	for (const [name, value] of [
		['origin', grid.origin],
		['spacing', grid.spacing],
		['counts', grid.counts],
	] as const) {
		if (!isTriple(value))
			throw new EngineError(
				'E1203',
				`${CALL}() got ${String(value)} for ${name}, which takes three finite numbers.`,
			);
	}
	if (Array.from(grid.spacing).some((s) => s <= 0))
		throw new EngineError(
			'E1108',
			`${CALL}() got a spacing of 0 or less; probes need a positive spacing.`,
		);
	if (Array.from(grid.counts).some((c) => !Number.isInteger(c) || c < 2))
		throw new EngineError(
			'E1108',
			`${CALL}() got a count below 2 or a fraction; give whole numbers of 2 or more.`,
		);
	checkCounts(CALL, grid.counts);
	const intensity = grid.intensity ?? 1;
	if (!Number.isFinite(intensity) || intensity < 0)
		throw new EngineError('E1108', `${CALL}() got the intensity ${intensity}; it takes 0 or more.`);
	const weight = grid.environmentWeight ?? 1;
	if (!Number.isFinite(weight) || weight < 0 || weight > 1)
		throw new EngineError(
			'E1108',
			`${CALL}() got the environmentWeight ${weight}; it takes 0 to 1.`,
		);
}

/** Throws E1108 for more probes along an axis than a grid's texture holds. */
function checkCounts(call: string, counts: ArrayLike<number>): void {
	for (let k = 0; k < 3; k++)
		if ((counts[k] as number) > (MOST_PROBES[k] as number))
			throw new EngineError(
				'E1108',
				`${call}() got ${counts[k]} probes along ${'xyz'[k]}, more than the ${MOST_PROBES[k]} that a grid holds. Use a larger spacing or a smaller box.`,
			);
}

/** True for three finite numbers in an array or a typed array. */
function isTriple(value: unknown): boolean {
	if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return false;
	const list = value as unknown as ArrayLike<unknown>;
	if (list.length !== 3) return false;
	for (let k = 0; k < 3; k++) if (!Number.isFinite(list[k])) return false;
	return true;
}

/**
 * The options of `bakeProbes`: the box the probes cover, how fine they are, and where the light
 * comes from.
 *
 * @category api/scene
 */
export interface BakeProbesOptions {
	/** The box the probes cover, in the world. */
	box: { min: readonly [number, number, number]; max: readonly [number, number, number] };
	/**
	 * The distance between probes along each axis, in meters, or one number for every axis. The
	 * default is 2. The grid starts at the box's least corner and takes as many probes as fit the
	 * box at that spacing, at least two along each axis.
	 */
	spacing?: number | readonly [number, number, number];
	/** The directions cast from each probe: 8 to 1024, the default 64. */
	samples?: number;
	/** How far a ray reaches before it counts as the sky, in meters. The default is the box's diagonal. */
	distance?: number;
	/**
	 * The scene's environment: the light that a surface sends back when a ray hits it. Without
	 * one, the bake counts no bounce light. The sky itself never bakes, because the shader reads
	 * the environment's live light for it.
	 */
	environment?: Environment | null;
	/**
	 * The intensity and rotation that `scene.setEnvironment` got, so the bounce light matches the
	 * scene's. The defaults are those of `scene.setEnvironment`.
	 */
	environmentOptions?: EnvironmentOptions;
	/**
	 * The color a ray takes when it hits a surface, for one colored bounce: the surface sends
	 * back that share of the environment's light at its normal, as a matte surface does. The
	 * bounce sees the whole sky, so the light of a hit has no occlusion of its own, and the bake
	 * counts no lamps. A ray whose hit has no color gives no bounce light, so a scene without this
	 * bakes the probes' sky visibility and validity alone. `normal` is reused from hit to hit, so
	 * copy what you keep, and return the same array each time where you can: the bake calls this
	 * for every hit.
	 */
	albedo?: (
		object: QueryTarget | null,
		instance: number,
		normal: Float32Array,
	) => readonly [number, number, number] | undefined;
}

/**
 * A baked grid: its placement, the L1 coefficients of its probes and the two masks that the shader
 * reads beside them.
 *
 * @category api/scene
 */
export class LightProbeGridData {
	constructor(
		/** The grid's corner of least x, y and z. */
		readonly origin: Float32Array,
		/** The spacing between probes along each axis. */
		readonly spacing: Float32Array,
		/** The probes along each axis. */
		readonly counts: [number, number, number],
		/** Four RGB coefficients per probe, of the light that its surroundings bounce back. */
		readonly coefficients: Float32Array,
		/**
		 * One number per probe: 1 where the probe stands in open space and 0 where geometry
		 * encloses it. A probe with 0 gives no light, which keeps it from leaking through the
		 * wall around it.
		 */
		readonly validity: Float32Array,
		/** One number per probe: the share of the sky that its rays reached, 0 to 1. */
		readonly skyVisibility: Float32Array,
	) {}

	/** The `rgba16float` 3D texture that `scene.setLightProbeGrid` takes. */
	toTexture(textures: Textures): Texture {
		const [width, height, depth] = gridTexels(this.counts);
		const texels = new Uint16Array(width * height * depth * 4);
		packProbes(
			this.counts,
			this.coefficients,
			this.validity,
			this.skyVisibility,
			texels,
			toHalfFloat,
		);
		return textures.fromVolumeData(
			width,
			height,
			depth,
			'rgba16float',
			texels,
			'LightProbeGridData.toTexture',
		);
	}
}

// The constants of the real spherical harmonics of the first two bands, in three.js's order.
const Y00 = 0.282095;
const Y1 = 0.488603;

/**
 * The irradiance at a surface of unit normal `(x, y, z)` from nine RGB coefficients of radiance,
 * into `out`, as the shader's `sh_irradiance`.
 */
function shIrradiance(sh: Float32Array, x: number, y: number, z: number, out: Float32Array): void {
	for (let c = 0; c < 3; c++)
		out[c] =
			(sh[c] as number) * L0_SCALE +
			L1_SCALE *
				((sh[3 + c] as number) * y + (sh[6 + c] as number) * z + (sh[9 + c] as number) * x) +
			2 *
				0.429043 *
				((sh[12 + c] as number) * x * y +
					(sh[15 + c] as number) * y * z +
					(sh[21 + c] as number) * x * z) +
			(sh[18 + c] as number) * (0.743125 * z * z - 0.247708) +
			(sh[24 + c] as number) * 0.429043 * (x * x - y * y);
}

/**
 * The rows that turn a direction in the world back into the environment map's own, for Euler
 * angles in the order X, Y, Z: the same matrix as the renderer gives the shaders' `map_direction`.
 */
function inverseRotation(rotation: readonly [number, number, number], out: Float32Array): void {
	const a = Math.cos(rotation[0]);
	const b = Math.sin(rotation[0]);
	const c = Math.cos(rotation[1]);
	const d = Math.sin(rotation[1]);
	const e = Math.cos(rotation[2]);
	const f = Math.sin(rotation[2]);
	out.set([
		c * e,
		a * f + b * e * d,
		b * f - a * e * d,
		-c * f,
		a * e - b * f * d,
		b * e + a * f * d,
		d,
		-b * c,
		a * c,
	]);
}

/**
 * A progressive bake of a light probe grid: `step` bakes the next probes and `finish` gives the
 * grid. Bake a few probes a frame from `onUpdate`, so a loading screen can show progress, or call
 * `finish` once.
 *
 * @category api/scene
 */
export class ProbeBake {
	/** The grid, filled probe by probe. */
	readonly grid: LightProbeGridData;
	/** How many probes the grid holds. */
	readonly total: number;
	private readonly samples: number;
	private readonly distance: number;
	private readonly directions: Float32Array;
	private readonly rays: Float32Array;
	private readonly distances: Float32Array;
	private readonly points: Float32Array;
	private readonly normals: Float32Array;
	private readonly objects: (QueryTarget | null)[];
	private readonly instances: Int32Array;
	private readonly hits: RaycastBatchHits;
	/** 1 for each ray that met the back of a surface, which means geometry encloses the probe. */
	private readonly backFacing: Uint8Array;
	private readonly sky: Float32Array | null;
	private readonly intensity: number;
	/** The rows that turn a world direction into the environment map's. */
	private readonly turn = new Float32Array(9);
	private readonly rayOptions: { maxDistance: number };
	/** The hit normal that the albedo callback reads, reused from hit to hit. */
	private readonly hitNormal = new Float32Array(3);
	/** The neighbours of the probe that the fill reads, reused from probe to probe. */
	private readonly near = new Uint32Array(6);
	/** The neighbours that the fill's queue reads, kept apart from the list that a visit writes. */
	private readonly around = new Uint32Array(6);
	private next = 0;
	private filled = false;

	/** @internal */
	constructor(
		private readonly scene: Scene,
		private readonly options: BakeProbesOptions,
	) {
		const min = options.box.min;
		const max = options.box.max;
		const step = options.spacing ?? 2;
		const per = typeof step === 'number' ? [step, step, step] : step;
		const spacing = new Float32Array(3);
		const counts = [FEWEST_PROBES, FEWEST_PROBES, FEWEST_PROBES];
		let diagonal = 0;
		for (let k = 0; k < 3; k++) {
			const span = Math.max((max[k] as number) - (min[k] as number), 0.01);
			spacing[k] = Math.max(per[k] as number, 0.01);
			counts[k] = Math.max(FEWEST_PROBES, Math.round(span / (spacing[k] as number)) + 1);
			diagonal += span * span;
		}
		const shown = counts as ProbeCounts;
		if (DEV) checkCounts('bakeProbes', shown);
		this.samples = Math.max(8, Math.min(options.samples ?? 64, 1024));
		this.distance = options.distance ?? (Math.sqrt(diagonal) || 1);
		this.total = shown[0] * shown[1] * shown[2];
		this.grid = new LightProbeGridData(
			new Float32Array([min[0] as number, min[1] as number, min[2] as number]),
			spacing,
			shown,
			new Float32Array(this.total * PROBE_FLOATS),
			new Float32Array(this.total).fill(1),
			new Float32Array(this.total),
		);
		this.directions = new Float32Array(this.samples * 3);
		fibonacciDirections(this.samples, this.directions);
		this.rays = new Float32Array(this.samples * 6);
		this.distances = new Float32Array(this.samples);
		this.points = new Float32Array(this.samples * 3);
		this.normals = new Float32Array(this.samples * 3);
		this.objects = new Array<QueryTarget | null>(this.samples).fill(null);
		this.instances = new Int32Array(this.samples);
		this.backFacing = new Uint8Array(this.samples);
		this.hits = {
			distances: this.distances,
			objects: this.objects,
			instances: this.instances,
			points: this.points,
			normals: this.normals,
		};
		this.sky = options.environment ? options.environment.sh : null;
		this.intensity = options.environmentOptions?.intensity ?? 1;
		inverseRotation(options.environmentOptions?.rotation ?? [0, 0, 0], this.turn);
		this.rayOptions = { maxDistance: this.distance };
	}

	/** How many probes are baked. */
	get done(): number {
		return this.next;
	}

	/** Bakes up to `budget` probes. Returns true when every probe is baked. */
	step(budget = 4): boolean {
		for (let n = 0; n < budget && this.next < this.total; n++) this.bakeProbe(this.next++);
		if (this.next < this.total) return false;
		if (!this.filled) {
			this.filled = true;
			this.fill();
		}
		return true;
	}

	/** Bakes every remaining probe and returns the grid. */
	finish(): LightProbeGridData {
		while (!this.step(64));
		return this.grid;
	}

	/**
	 * Casts `samples` rays from probe `index`, adds the light that their surfaces bounce to its
	 * coefficients, and records how much sky it sees and whether geometry encloses it.
	 */
	private bakeProbe(index: number): void {
		const { origin, spacing, counts, coefficients, validity, skyVisibility } = this.grid;
		const columns = counts[0];
		const rows = counts[1];
		const x = (origin[0] as number) + (index % columns) * (spacing[0] as number);
		const y = (origin[1] as number) + (Math.floor(index / columns) % rows) * (spacing[1] as number);
		const z = (origin[2] as number) + Math.floor(index / (columns * rows)) * (spacing[2] as number);
		const { rays, directions, backFacing } = this;
		for (let s = 0; s < this.samples; s++) {
			rays[s * 6] = x;
			rays[s * 6 + 1] = y;
			rays[s * 6 + 2] = z;
			rays[s * 6 + 3] = directions[s * 3] as number;
			rays[s * 6 + 4] = directions[s * 3 + 1] as number;
			rays[s * 6 + 5] = directions[s * 3 + 2] as number;
		}
		// Both faces are tested, so a ray from inside a wall meets the back of the wall and says so.
		this.scene.raycastBatchFaces(rays, this.rayOptions, this.hits, backFacing);
		const at = index * PROBE_FLOATS;
		// Monte Carlo projection over the whole sphere: each direction stands for 4 pi / samples.
		const scale = (4 * Math.PI) / this.samples;
		const { normals, hitNormal } = this;
		let sky = 0;
		let enclosed = 0;
		for (let s = 0; s < this.samples; s++) {
			const dx = directions[s * 3] as number;
			const dy = directions[s * 3 + 1] as number;
			const dz = directions[s * 3 + 2] as number;
			if ((this.distances[s] as number) < 0) {
				sky++;
				continue;
			}
			// A ray that met the back of a surface came from inside geometry, and the light it
			// gathers is that of the solid, not of the space around the probe.
			if ((backFacing[s] as number) !== 0) {
				enclosed++;
				continue;
			}
			if (!this.options.albedo) continue;
			hitNormal[0] = normals[s * 3] as number;
			hitNormal[1] = normals[s * 3 + 1] as number;
			hitNormal[2] = normals[s * 3 + 2] as number;
			const albedo = this.options.albedo(
				this.objects[s] as QueryTarget | null,
				this.instances[s] as number,
				hitNormal,
			);
			if (!albedo) continue;
			// A matte surface sends back albedo times its irradiance over pi.
			const light = this.environmentIrradiance(
				hitNormal[0] as number,
				hitNormal[1] as number,
				hitNormal[2] as number,
			);
			const red = ((albedo[0] as number) * (light[0] as number)) / Math.PI;
			const green = ((albedo[1] as number) * (light[1] as number)) / Math.PI;
			const blue = ((albedo[2] as number) * (light[2] as number)) / Math.PI;
			// The four coefficients, in the shader's order: L0, then L1 along y, z and x.
			coefficients[at] = (coefficients[at] as number) + red * Y00 * scale;
			coefficients[at + 1] = (coefficients[at + 1] as number) + green * Y00 * scale;
			coefficients[at + 2] = (coefficients[at + 2] as number) + blue * Y00 * scale;
			const y1 = dy * Y1 * scale;
			const z1 = dz * Y1 * scale;
			const x1 = dx * Y1 * scale;
			coefficients[at + 3] = (coefficients[at + 3] as number) + red * y1;
			coefficients[at + 4] = (coefficients[at + 4] as number) + green * y1;
			coefficients[at + 5] = (coefficients[at + 5] as number) + blue * y1;
			coefficients[at + 6] = (coefficients[at + 6] as number) + red * z1;
			coefficients[at + 7] = (coefficients[at + 7] as number) + green * z1;
			coefficients[at + 8] = (coefficients[at + 8] as number) + blue * z1;
			coefficients[at + 9] = (coefficients[at + 9] as number) + red * x1;
			coefficients[at + 10] = (coefficients[at + 10] as number) + green * x1;
			coefficients[at + 11] = (coefficients[at + 11] as number) + blue * x1;
		}
		skyVisibility[index] = sky / this.samples;
		// A probe that most rays enter from behind stands inside geometry. Its light is the solid's,
		// so it takes none, and the fill below hands it the light of the probes around it.
		validity[index] = enclosed * 2 > this.samples ? 0 : 1;
	}

	/**
	 * Fills each probe that geometry encloses with the light of the probes that it reaches, so a
	 * wall's probe holds the light of the room beside it. Its validity stays 0, so the light it
	 * takes is a smooth falloff for the filter and never a source of its own.
	 */
	private fill(): void {
		const { counts, coefficients, validity, skyVisibility } = this.grid;
		const [nx, ny, nz] = counts;
		const total = this.total;
		// 1 for a probe that the bake left valid, 2 for one that the fill has given light.
		const state = new Uint8Array(total);
		const queue = new Uint32Array(total);
		const near = this.near;
		const around = this.around;
		let head = 0;
		let tail = 0;
		for (let p = 0; p < total; p++)
			if ((validity[p] as number) > 0) {
				state[p] = 1;
				queue[tail++] = p;
			}
		const visit = (p: number) => {
			if (state[p] !== 0) return;
			const count = neighbours(p, nx, ny, nz, near);
			let resolved = 0;
			for (let q = 0; q < count; q++) if ((state[near[q] as number] as number) !== 0) resolved++;
			if (resolved === 0) return;
			for (let c = 0; c < PROBE_FLOATS; c++) {
				let sum = 0;
				for (let q = 0; q < count; q++) {
					const other = near[q] as number;
					if ((state[other] as number) !== 0)
						sum += coefficients[other * PROBE_FLOATS + c] as number;
				}
				coefficients[p * PROBE_FLOATS + c] = sum / resolved;
			}
			let sky = 0;
			for (let q = 0; q < count; q++) {
				const other = near[q] as number;
				if ((state[other] as number) !== 0) sky += skyVisibility[other] as number;
			}
			skyVisibility[p] = sky / resolved;
			state[p] = 2;
			queue[tail++] = p;
		};
		while (head < tail) {
			const p = queue[head++] as number;
			// The visit writes its own neighbour list, so the loop reads a list of its own.
			const count = neighbours(p, nx, ny, nz, around);
			for (let q = 0; q < count; q++) visit(around[q] as number);
		}
	}

	/**
	 * The environment's irradiance at a surface whose unit normal is `(x, y, z)`, turned and scaled
	 * as the scene's. Zero without an environment.
	 */
	private environmentIrradiance(x: number, y: number, z: number): Float32Array {
		const sky = this.sky;
		if (!sky) return ZERO;
		const t = this.turn;
		shIrradiance(
			sky,
			(t[0] as number) * x + (t[1] as number) * y + (t[2] as number) * z,
			(t[3] as number) * x + (t[4] as number) * y + (t[5] as number) * z,
			(t[6] as number) * x + (t[7] as number) * y + (t[8] as number) * z,
			SKY,
		);
		for (let c = 0; c < 3; c++) SKY[c] = (SKY[c] as number) * this.intensity;
		return SKY;
	}
}

/** Writes the probes that sit next to probe `p` into `out`, and returns how many, at most six. */
function neighbours(p: number, nx: number, ny: number, nz: number, out: Uint32Array): number {
	const i = p % nx;
	const j = Math.floor(p / nx) % ny;
	const k = Math.floor(p / (nx * ny));
	let count = 0;
	if (i > 0) out[count++] = p - 1;
	if (i + 1 < nx) out[count++] = p + 1;
	if (j > 0) out[count++] = p - nx;
	if (j + 1 < ny) out[count++] = p + nx;
	if (k > 0) out[count++] = p - nx * ny;
	if (k + 1 < nz) out[count++] = p + nx * ny;
	return count;
}

const ZERO = new Float32Array(3);
const SKY = new Float32Array(3);

/**
 * Bakes a light probe grid over `options.box`, progressively (see `ProbeBake`).
 *
 * @category api/scene
 */
export function bakeProbes(scene: Scene, options: BakeProbesOptions): ProbeBake {
	return new ProbeBake(scene, options);
}
