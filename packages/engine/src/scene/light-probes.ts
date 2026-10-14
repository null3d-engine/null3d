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
import type { CoreMemory, ViewHolder } from './memory';
import type { Texture } from './textures';

// Light probe grids: a three-dimensional grid of irradiance probes, each holding L1 spherical
// harmonics of the light that reaches its point (see `.dev/decisions/D-146-light-probe-grid.md`).
// Standard materials read the grid per pixel, three hardware-filtered reads each, to light a scene
// with the light that its own walls, ground and sky bounce back, which one scene-wide environment
// cannot show.
//
// This module holds the shape of the grid and the maths that the bake and the shaders share, so the
// CPU bake and the WGSL sampling agree. The renderer binds the packed texels as one RGBA16F 3D
// texture: three sub-volumes along Z, one per `vec4f` of a probe's four RGB coefficients, each with
// one padding slice at either end, so hardware trilinear filtering never blends across sub-volumes.
// The coefficient order is the shader's, which is three.js's own: L0, then L1 along y, along z and
// along x, four RGB coefficients in all.

/** The probes along the least axis of a grid, and the most. */
export const FEWEST_PROBES = 2;
export const MOST_PROBES = 128;

/** The sub-volumes of a probe's texture along Z: three, because L1 needs three `vec4f`. */
export const PROBE_SUBVOLUMES = 3;

/** The floats of one probe's four RGB coefficients. */
export const PROBE_FLOATS = 12;

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
 * `coefficients`, three numbers into `out`, as the shader's first four `sh_irradiance` terms.
 */
export function l1Irradiance(
	coefficients: Float32Array,
	at: number,
	x: number,
	y: number,
	z: number,
	out: Float32Array,
): void {
	out[0] =
		(coefficients[at] as number) * L0_SCALE + (coefficients[at + 3] as number) * L1_SCALE * x;
	out[1] =
		(coefficients[at + 1] as number) * L0_SCALE + (coefficients[at + 4] as number) * L1_SCALE * x;
	out[2] =
		(coefficients[at + 2] as number) * L0_SCALE + (coefficients[at + 5] as number) * L1_SCALE * x;
}

/**
 * The irradiance that a grid of `counts` probes gives a surface at world position `(px, py, pz)`
 * with unit normal `(nx, ny, nz)`, as the shader reads it. `origin` and `spacing` place the grid,
 * `coefficients` holds four RGB coefficients per probe, and the sample point moves half a probe
 * spacing along the normal, so light does not leak across a wall. `work` holds at least 12 numbers,
 * the interpolated coefficients. Writes three numbers into `out`.
 */
export function sampleGrid(
	coefficients: Float32Array,
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
	// The eight probes' four RGB coefficients interpolate first: irradiance is linear in them, so
	// this gives the same light as interpolating its value at each of the eight.
	const at = (i: number, j: number, k: number) =>
		((k * counts[1] + j) * counts[0] + i) * PROBE_FLOATS;
	for (let c = 0; c < PROBE_FLOATS; c++) {
		const x0 = mix(
			coefficients[at(i0, j0, k0) + c] as number,
			coefficients[at(i1, j0, k0) + c] as number,
			fx,
		);
		const x1 = mix(
			coefficients[at(i0, j1, k0) + c] as number,
			coefficients[at(i1, j1, k0) + c] as number,
			fx,
		);
		const x2 = mix(
			coefficients[at(i0, j0, k1) + c] as number,
			coefficients[at(i1, j0, k1) + c] as number,
			fx,
		);
		const x3 = mix(
			coefficients[at(i0, j1, k1) + c] as number,
			coefficients[at(i1, j1, k1) + c] as number,
			fx,
		);
		work[c] = mix(mix(x0, x1, fy), mix(x2, x3, fy), fz);
	}
	l1Irradiance(work, 0, nx, ny, nz, out);
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

/** The GPU bytes of a packed grid: 24 per probe, plus the padding slices. */
export function gridBytes(counts: ProbeCounts): number {
	const [w, h, d] = gridTexels(counts);
	return w * h * d * 8;
}

/**
 * Packs four RGB coefficients per probe into the RGBA16F texels of the grid's 3D texture: half
 * floats in rows from the bottom up, slice after slice. The first texel of a probe holds L0's red,
 * green and blue and L1y's red, and the padding slices stay zero, so a filter across one fades to
 * no light instead of to a neighbour's coefficients.
 */
export function packProbes(
	counts: ProbeCounts,
	coefficients: Float32Array,
	texels: Uint16Array,
	toHalf: (value: number) => number,
): void {
	const [nx, ny, nz] = counts;
	for (let k = 0; k < nz; k++) {
		for (let j = 0; j < ny; j++) {
			for (let i = 0; i < nx; i++) {
				const at = ((k * ny + j) * nx + i) * PROBE_FLOATS;
				for (let s = 0; s < PROBE_SUBVOLUMES; s++) {
					const texel = ((s * (nz + 2) + 1 + k) * ny + j) * nx + i;
					for (let c = 0; c < 4; c++)
						texels[texel * 4 + c] = toHalf(coefficients[at + s * 4 + c] as number);
				}
			}
		}
	}
}

/**
 * The options of `scene.setLightProbeGrid`: a grid of irradiance probes, baked by `bakeProbes`
 * or elsewhere, whose texture the sketch uploads with `textures.fromData({ ..., format:
 * 'rgba16float' })`.
 *
 * @category api/scene
 */
export interface LightProbeGridOptions {
	/** The 3D texture of the probes' coefficients, from `textures.fromData`. */
	texture: Texture;
	/** The grid's corner of least x, y and z, in the world. */
	origin: readonly [number, number, number];
	/** The distance between probes along each axis, in meters. */
	spacing: readonly [number, number, number];
	/** The probes along each axis. */
	counts: readonly [number, number, number];
	/** The factor of the grid's light on every surface. The default is 1. */
	intensity?: number;
	/**
	 * The share of the environment's diffuse light that the grid takes over, 0 to 1. The default
	 * is 1: the bake counts the sky already, so the grid replaces that light.
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
	 * a texture, and E1101 for a texture that was destroyed.
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
		if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
			throw new EngineError(
				'E1203',
				`${CALL}() got ${String(value)} for ${name}, which takes three finite numbers.`,
			);
	}
	if (grid.spacing.some((s) => s <= 0))
		throw new EngineError(
			'E1108',
			`${CALL}() got a spacing of 0 or less; probes need a positive spacing.`,
		);
	if (grid.counts.some((c) => !Number.isInteger(c) || c < 2))
		throw new EngineError(
			'E1108',
			`${CALL}() got a count below 2 or a fraction; give whole numbers of 2 or more.`,
		);
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
