import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	LIGHT_PROBE_VALUE_COUNT,
	LIGHT_PROBE_VALUE_COUNTS,
	LIGHT_PROBE_VALUE_ENVIRONMENT_WEIGHT,
	LIGHT_PROBE_VALUE_INTENSITY,
	LIGHT_PROBE_VALUE_ORIGIN,
	LIGHT_PROBE_VALUE_SKY_LUMINANCE,
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
// Standard materials read the grid per pixel, three hardware-filtered reads each, to light a scene
// with the light that its own walls, ground and sky bounce back, which one scene-wide environment
// cannot show.
//
// This module holds the shape of the grid and the maths that the bake and the shaders share, so the
// CPU bake and the WGSL sampling agree. The renderer binds the packed texels as one RGBA16F 3D
// texture: four sub-volumes along Z, each with one padding slice at either end, so hardware
// trilinear filtering never blends across sub-volumes. Three of them hold a probe's four RGB
// coefficients; the fourth holds how much sky the probe sees, and its weight in the filter. The
// coefficient order is the shader's, which is three.js's own: L0, then L1 along y, along z and
// along x, four RGB coefficients in all.
//
// Each probe's weight is a validity mask: a probe inside geometry, or in a gap narrower than the
// grid's spacing, carries no weight in the filter, so its light cannot leak into a neighbouring
// space (D-179 ruling 12, and D-146's addendum). The coefficients travel premultiplied by that
// weight, and the shader divides the filtered result by the filtered weight, which drops the
// invalid probes and gives the others their share again.

/** The sub-volumes of a probe's texture along Z: three L1 `vec4f` and the mask. */
export const PROBE_SUBVOLUMES = 4;

/** The sub-volume that holds a probe's sky occlusion and its validity weight. */
export const PROBE_MASK_SUBVOLUME = 3;

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

/** The filtered weight below which no valid probe surrounds a sample point. */
const MIN_FILTERED_WEIGHT = 0.001;

/** How far a probe's validity rays reach, in cells, which stays inside the cell beside it. */
const MASK_REACH_CELLS = 1.5;

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

/** What a grid's light takes from the scene around it. */
export interface GridSampleOptions {
	/** The environment's irradiance at the surface's normal, which the grid's sky term takes. */
	environment: ArrayLike<number>;
	/** The sky's brightness now against the bake's, which scales the baked light. The default is 1. */
	skyScale?: number;
	/** The grid's intensity, 1 by default. */
	intensity?: number;
}

/**
 * The irradiance that a grid gives a surface at world position `(px, py, pz)` with unit normal
 * `(nx, ny, nz)`, as the shader reads it: the probes' baked light, scaled by the sky's brightness,
 * plus the environment's light times how much sky reaches the probes there. The sample point moves
 * half a probe spacing along the normal, and the probes' weights drop the ones that the bake found
 * inside geometry. `work` holds at least 12 numbers, the interpolated coefficients. Writes three
 * numbers into `out`.
 */
export function sampleGrid(
	grid: LightProbeGridData,
	px: number,
	py: number,
	pz: number,
	nx: number,
	ny: number,
	nz: number,
	options: GridSampleOptions,
	work: Float32Array,
	out: Float32Array,
): void {
	const { coefficients, validity, skyOcclusion, counts, origin, spacing } = grid;
	const { environment } = options;
	const skyScale = options.skyScale ?? 1;
	const intensity = options.intensity ?? 1;
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
	// The eight probes around the sample point, and the share of the filter that each one holds.
	const corners = [
		i0,
		j0,
		k0,
		i1,
		j0,
		k0,
		i0,
		j1,
		k0,
		i1,
		j1,
		k0,
		i0,
		j0,
		k1,
		i1,
		j0,
		k1,
		i0,
		j1,
		k1,
		i1,
		j1,
		k1,
	];
	const along = [1 - fx, fx];
	const across = [1 - fy, fy];
	const up = [1 - fz, fz];
	const probe = (n: number) =>
		((corners[n * 3 + 2] as number) * counts[1] + (corners[n * 3 + 1] as number)) * counts[0] +
		(corners[n * 3] as number);
	// A probe's share of the filter, which its weight then scales: a probe with no weight adds
	// nothing, to its light or to that light's own share.
	let weight = 0;
	for (let n = 0; n < 8; n++)
		weight +=
			(along[n & 1] as number) *
			(across[(n >> 1) & 1] as number) *
			(up[(n >> 2) & 1] as number) *
			(validity[probe(n)] as number);
	// No valid probe around the surface: nothing was baked for its space, so the environment's own
	// light takes the grid's place, as the shader does.
	if (weight < MIN_FILTERED_WEIGHT) {
		for (let c = 0; c < 3; c++) out[c] = environment[c] as number;
		return;
	}
	const share = 1 / weight;
	// The eight probes' four RGB coefficients interpolate first: irradiance is linear in them, so
	// this gives the same light as interpolating its value at each of the eight.
	for (let c = 0; c < PROBE_FLOATS; c++) {
		let sum = 0;
		for (let n = 0; n < 8; n++)
			sum +=
				(along[n & 1] as number) *
				(across[(n >> 1) & 1] as number) *
				(up[(n >> 2) & 1] as number) *
				(coefficients[probe(n) * PROBE_FLOATS + c] as number);
		work[c] = sum * share;
	}
	let sky = 0;
	for (let n = 0; n < 8; n++)
		sky +=
			(along[n & 1] as number) *
			(across[(n >> 1) & 1] as number) *
			(up[(n >> 2) & 1] as number) *
			(skyOcclusion[probe(n)] as number);
	sky *= share;
	l1Irradiance(work, 0, nx, ny, nz, out);
	for (let c = 0; c < 3; c++)
		out[c] = ((out[c] as number) * skyScale + sky * (environment[c] as number)) * intensity;
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
 * Packs four RGB coefficients per probe into the RGBA16F texels of the grid's 3D texture: half
 * floats in rows from the bottom up, slice after slice. The first texel of a probe holds L0's red,
 * green and blue and L1y's red, and the padding slices stay zero, so a filter across one fades to
 * no light instead of to a neighbour's coefficients.
 *
 * The coefficients are premultiplied by the probe's validity, and the mask sub-volume holds the
 * sky occlusion times that validity in red and the validity in alpha, so one filtered read gives
 * the valid probes' share and the light that reaches them.
 */
export function packProbes(
	counts: ProbeCounts,
	coefficients: Float32Array,
	validity: Float32Array,
	skyOcclusion: Float32Array,
	texels: Uint16Array,
	toHalf: (value: number) => number,
): void {
	const [nx, ny, nz] = counts;
	for (let k = 0; k < nz; k++) {
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				const probe = (k * ny + j) * nx + i;
				const at = probe * PROBE_FLOATS;
				const weight = validity[probe] as number;
				for (let s = 0; s < PROBE_MASK_SUBVOLUME; s++) {
					const texel = ((s * (nz + 2) + 1 + k) * ny + j) * nx + i;
					for (let c = 0; c < 4; c++)
						texels[texel * 4 + c] = toHalf((coefficients[at + s * 4 + c] as number) * weight);
				}
				const texel = ((PROBE_MASK_SUBVOLUME * (nz + 2) + 1 + k) * ny + j) * nx + i;
				texels[texel * 4] = toHalf((skyOcclusion[probe] as number) * weight);
				texels[texel * 4 + 1] = 0;
				texels[texel * 4 + 2] = 0;
				texels[texel * 4 + 3] = toHalf(weight);
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
	 * is 1: the grid's sky term is the environment's own light, so the grid replaces it.
	 */
	environmentWeight?: number;
	/**
	 * The average radiance of the sky when the grid was baked, 0 or more. Each frame scales the
	 * grid's baked light by the scene sky's brightness now against this one, so a day cycle dims
	 * the light that the bake caught. The default is 0, which keeps the baked light as it is.
	 * `bakeProbes` sets it from its own environment.
	 */
	skyLuminance?: number;
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
			const {
				origin,
				spacing,
				counts,
				intensity = 1,
				environmentWeight = 1,
				skyLuminance = 0,
			} = grid;
			for (let k = 0; k < 3; k++) {
				values[LIGHT_PROBE_VALUE_ORIGIN + k] = origin[k] as number;
				values[LIGHT_PROBE_VALUE_SPACING + k] = spacing[k] as number;
				values[LIGHT_PROBE_VALUE_COUNTS + k] = counts[k] as number;
			}
			values[LIGHT_PROBE_VALUE_INTENSITY] = intensity;
			values[LIGHT_PROBE_VALUE_ENVIRONMENT_WEIGHT] = environmentWeight;
			values[LIGHT_PROBE_VALUE_SKY_LUMINANCE] = skyLuminance;
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
	const sky = grid.skyLuminance ?? 0;
	if (!Number.isFinite(sky) || sky < 0)
		throw new EngineError('E1108', `${CALL}() got the skyLuminance ${sky}; it takes 0 or more.`);
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
	 * The scene's environment, whose light a bounce counts and whose brightness the grid keeps. A
	 * ray that reaches the sky counts toward the probe's sky occlusion, which the live sky's light
	 * multiplies in every frame. Without one, the probes see no sky light and the bounce is dark.
	 */
	environment?: Environment | null;
	/**
	 * The intensity and rotation that `scene.setEnvironment` got, so the baked sky matches the
	 * scene's. The defaults are those of `scene.setEnvironment`.
	 */
	environmentOptions?: EnvironmentOptions;
	/**
	 * The color a ray takes when it hits a surface, for one colored bounce: the surface sends
	 * back that share of the environment's light at its normal, as a matte surface does. The
	 * bounce sees the whole sky, so the light of a hit has no occlusion of its own, and the bake
	 * counts no lamps. A ray whose hit has no color gives none, so a scene without this bakes the
	 * sky's occlusion alone. `normal` is reused from hit to hit, so copy what you keep,
	 * and return the same array each time where you can: the bake calls this for every hit.
	 */
	albedo?: (
		object: QueryTarget | null,
		instance: number,
		normal: Float32Array,
	) => readonly [number, number, number] | undefined;
}

/**
 * A baked grid: its placement, the L1 coefficients of its probes, four RGB each, and the mask and
 * sky occlusion that keep its light where it was baked.
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
		/**
		 * Four RGB coefficients per probe. They hold the light that surfaces send back, and no sky
		 * light: the sky reaches a surface through `skyOcclusion` instead.
		 */
		readonly coefficients: Float32Array,
		/**
		 * Each probe's weight in the filter, 0 to 1. A probe inside geometry, or in a gap narrower
		 * than the grid's spacing, carries none, so its light cannot leak into the space around it.
		 * The default is 1 for every probe.
		 */
		readonly validity: Float32Array = new Float32Array(counts[0] * counts[1] * counts[2]).fill(1),
		/**
		 * The share of the sky that reaches each probe, 0 to 1, which the live sky's color
		 * multiplies. The default is 0 for every probe, which lights no sky from the grid.
		 */
		readonly skyOcclusion: Float32Array = new Float32Array(counts[0] * counts[1] * counts[2]),
		/**
		 * The average radiance of the sky when the grid was baked, which scales the baked light
		 * against the sky's own brightness in each frame. The default is 0, which keeps the baked
		 * light at the brightness it was baked with.
		 */
		readonly skyLuminance: number = 0,
	) {}

	/** The `rgba16float` 3D texture that `scene.setLightProbeGrid` takes. */
	toTexture(textures: Textures): Texture {
		const [width, height, depth] = gridTexels(this.counts);
		const texels = new Uint16Array(width * height * depth * 4);
		packProbes(
			this.counts,
			this.coefficients,
			this.validity,
			this.skyOcclusion,
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

// The constants of the real spherical harmonics of the first two bands, in three.js's order, which
// the bake multiplies a direction and a radiance by.
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
	/** The rays of the validity test, six per probe: two along each axis. */
	private readonly maskRays = 6;
	/** How far the validity test's rays reach, which stays inside the cell and the one beside it. */
	private readonly maskReach: number;
	private readonly distance: number;
	private readonly directions: Float32Array;
	private readonly rays: Float32Array;
	private readonly distances: Float32Array;
	private readonly points: Float32Array;
	private readonly normals: Float32Array;
	private readonly objects: (QueryTarget | null)[];
	private readonly instances: Int32Array;
	private readonly hits: RaycastBatchHits;
	private readonly sky: Float32Array | null;
	private readonly intensity: number;
	/** Each probe's weight in the filter, which a probe inside geometry loses. */
	private readonly validity: Float32Array;
	/** The share of the sky that reaches each probe. */
	private readonly occlusion: Float32Array;
	/** The distance between probes along each axis. */
	private readonly spacing: Float32Array;
	/** The rows that turn a world direction into the environment map's. */
	private readonly turn = new Float32Array(9);
	private readonly rayOptions: { maxDistance: number };
	/** The validity test's rays, which start outside the probe's cell, and what they meet. */
	private readonly maskRayData: Float32Array;
	private readonly maskDistances: Float32Array;
	private readonly maskHits: RaycastBatchHits;
	private readonly maskOptions: { maxDistance: number };
	/** The hit normal that the albedo callback reads, reused from hit to hit. */
	private readonly hitNormal = new Float32Array(3);
	private next = 0;

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
		this.intensity = options.environmentOptions?.intensity ?? 1;
		const validity = new Float32Array(this.total);
		const occlusion = new Float32Array(this.total);
		this.sky = options.environment ? options.environment.sh : null;
		// The sky's average radiance at the bake, which scales the baked light in every frame.
		const skyLuminance = this.sky
			? ((this.sky[0] as number) * 0.2126 +
					(this.sky[1] as number) * 0.7152 +
					(this.sky[2] as number) * 0.0722) *
				this.intensity
			: 0;
		this.grid = new LightProbeGridData(
			new Float32Array([min[0] as number, min[1] as number, min[2] as number]),
			spacing,
			shown,
			new Float32Array(this.total * PROBE_FLOATS),
			validity,
			occlusion,
			skyLuminance,
		);
		this.validity = validity;
		this.occlusion = occlusion;
		this.spacing = spacing;
		this.directions = new Float32Array(this.samples * 3);
		fibonacciDirections(this.samples, this.directions);
		this.rays = new Float32Array(this.samples * 6);
		this.distances = new Float32Array(this.samples);
		this.points = new Float32Array(this.samples * 3);
		this.normals = new Float32Array(this.samples * 3);
		this.objects = new Array<QueryTarget | null>(this.samples).fill(null);
		this.instances = new Int32Array(this.samples);
		this.hits = {
			distances: this.distances,
			objects: this.objects,
			instances: this.instances,
			points: this.points,
			normals: this.normals,
		};
		// The validity test's rays reach no further than the cell beside each probe, so the first
		// surface that one meets bounds the space that the probe sits in rather than the room's far
		// wall. Each ray starts just outside that reach and travels inward.
		this.maskReach =
			Math.min(spacing[0] as number, spacing[1] as number, spacing[2] as number) * MASK_REACH_CELLS;
		this.maskRayData = new Float32Array(this.maskRays * 6);
		this.maskDistances = new Float32Array(this.maskRays);
		this.maskHits = { distances: this.maskDistances };
		this.maskOptions = { maxDistance: this.maskReach };
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
		return this.next >= this.total;
	}

	/** Bakes every remaining probe and returns the grid. */
	finish(): LightProbeGridData {
		while (!this.step(64));
		return this.grid;
	}

	/**
	 * Casts `samples` rays from probe `index`, which bake the light that surfaces send back there,
	 * and the six rays of the validity test, which measure the free space around it. The share of
	 * the sky that reaches the probe is the share of its rays that reach the sky.
	 */
	private bakeProbe(index: number): void {
		const { origin, counts, coefficients } = this.grid;
		const columns = counts[0];
		const rows = counts[1];
		const x = (origin[0] as number) + (index % columns) * (this.spacing[0] as number);
		const y =
			(origin[1] as number) + (Math.floor(index / columns) % rows) * (this.spacing[1] as number);
		const z =
			(origin[2] as number) + Math.floor(index / (columns * rows)) * (this.spacing[2] as number);
		const { rays, directions, maskRayData, maskReach } = this;
		for (let s = 0; s < this.samples; s++) {
			rays[s * 6] = x;
			rays[s * 6 + 1] = y;
			rays[s * 6 + 2] = z;
			rays[s * 6 + 3] = directions[s * 3] as number;
			rays[s * 6 + 4] = directions[s * 3 + 1] as number;
			rays[s * 6 + 5] = directions[s * 3 + 2] as number;
		}
		// The validity test's rays start just outside the probe's cell and travel inward along each
		// axis, so the first surface that one meets bounds the free space on that side.
		for (let axis = 0; axis < 3; axis++) {
			for (let side = 0; side < 2; side++) {
				const s = axis * 2 + side;
				const along = side === 0 ? 1 : -1;
				maskRayData[s * 6] = x + (axis === 0 ? along * maskReach : 0);
				maskRayData[s * 6 + 1] = y + (axis === 1 ? along * maskReach : 0);
				maskRayData[s * 6 + 2] = z + (axis === 2 ? along * maskReach : 0);
				maskRayData[s * 6 + 3] = axis === 0 ? -along : 0;
				maskRayData[s * 6 + 4] = axis === 1 ? -along : 0;
				maskRayData[s * 6 + 5] = axis === 2 ? -along : 0;
			}
		}
		this.scene.raycastBatch(rays, this.rayOptions, this.hits);
		this.scene.raycastBatch(maskRayData, this.maskOptions, this.maskHits);
		this.readMask(index);
		const at = index * PROBE_FLOATS;
		// Monte Carlo projection over the whole sphere: each direction stands for 4 pi / samples.
		const scale = (4 * Math.PI) / this.samples;
		const { normals, hitNormal } = this;
		for (let s = 0; s < this.samples; s++) {
			const dx = directions[s * 3] as number;
			const dy = directions[s * 3 + 1] as number;
			const dz = directions[s * 3 + 2] as number;
			if ((this.distances[s] as number) < 0) continue;
			let red = 0;
			let green = 0;
			let blue = 0;
			if (this.options.albedo) {
				hitNormal[0] = normals[s * 3] as number;
				hitNormal[1] = normals[s * 3 + 1] as number;
				hitNormal[2] = normals[s * 3 + 2] as number;
				const albedo = this.options.albedo(
					this.objects[s] as QueryTarget | null,
					this.instances[s] as number,
					hitNormal,
				);
				if (albedo) {
					// A matte surface sends back albedo times its irradiance over pi.
					const light = this.hitLight(
						hitNormal[0] as number,
						hitNormal[1] as number,
						hitNormal[2] as number,
					);
					red = ((albedo[0] as number) * (light[0] as number)) / Math.PI;
					green = ((albedo[1] as number) * (light[1] as number)) / Math.PI;
					blue = ((albedo[2] as number) * (light[2] as number)) / Math.PI;
				}
			}
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
	}

	/**
	 * Writes probe `index`'s sky occlusion and validity from the rays that it cast: the share of its
	 * rays that reached the sky, and whether the free space around it is at least a cell wide. A
	 * probe inside geometry, or in a gap that the grid cannot resolve, carries no weight, so its
	 * light cannot leak into the space around it.
	 */
	private readMask(index: number): void {
		const { distances, samples, spacing, maskDistances, maskReach } = this;
		let sky = 0;
		for (let s = 0; s < samples; s++) if ((distances[s] as number) < 0) sky++;
		this.occlusion[index] = sky / samples;
		let weight = 1;
		for (let axis = 0; axis < 3; axis++) {
			const fromAhead = maskDistances[axis * 2] as number;
			const fromBehind = maskDistances[axis * 2 + 1] as number;
			// A ray that meets nothing leaves its side open, so nothing encloses the probe along this
			// axis. Its own distance is negative, which names no surface.
			if (!(fromAhead >= 0) || !(fromBehind >= 0)) continue;
			// The rays travel inward from either end of the axis. A surface beyond the probe on the
			// other side also leaves this side open.
			const ahead = maskReach - fromAhead;
			const behind = fromBehind - maskReach;
			if (!(ahead > 0) || !(behind < 0)) continue;
			const free = (ahead - behind) / (spacing[axis] as number);
			weight = Math.min(weight, (free - MASK_FREE_LOW) / (MASK_FREE_HIGH - MASK_FREE_LOW));
		}
		this.validity[index] = Math.max(0, Math.min(1, weight));
	}

	/**
	 * The environment's irradiance at a surface of unit normal `(x, y, z)`, turned and scaled as the
	 * scene's: the light that a surface there sends back. Zero without an environment.
	 */
	private hitLight(x: number, y: number, z: number): Float32Array {
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

const ZERO = new Float32Array(3);
const SKY = new Float32Array(3);

/**
 * The free space around a probe, in cells along an axis, that keeps its whole weight, and the free
 * space at or below which it keeps none. Between the two its weight fades, so the light of a space
 * changes smoothly across a wall rather than stepping.
 */
const MASK_FREE_HIGH = 1.15;
const MASK_FREE_LOW = 0.85;

/**
 * Bakes a light probe grid over `options.box`, progressively (see `ProbeBake`).
 *
 * @category api/scene
 */
export function bakeProbes(scene: Scene, options: BakeProbesOptions): ProbeBake {
	return new ProbeBake(scene, options);
}
