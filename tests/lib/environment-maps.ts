// Reads the light in an environment map from the asset tool, on the CPU, as a shader samples the
// cube map: the face that a direction points into, bilinear filtering within the face, and a blend
// between two levels for a fractional level.
import type { EnvironmentFile } from '../../packages/cli/src/assets/env.js';

export type Rgb = [number, number, number];

/** The face that a direction points into, and the place on it from 0 to 1 across and down. */
export function faceCoords([x, y, z]: readonly number[]): [number, number, number] {
	const [ax, ay, az] = [Math.abs(x as number), Math.abs(y as number), Math.abs(z as number)];
	const pick = (): [number, number, number, number] => {
		if (ax >= ay && ax >= az)
			return (x as number) > 0
				? [0, -(z as number), -(y as number), ax]
				: [1, z as number, -(y as number), ax];
		if (ay >= az)
			return (y as number) > 0
				? [2, x as number, z as number, ay]
				: [3, x as number, -(z as number), ay];
		return (z as number) > 0
			? [4, x as number, -(y as number), az]
			: [5, -(x as number), -(y as number), az];
	};
	const [face, sc, tc, major] = pick();
	return [face, (sc / major + 1) / 2, (tc / major + 1) / 2];
}

/** A shared-exponent texel's light. */
export function fromRgb9e5(texel: number): Rgb {
	const unit = 2 ** ((texel >>> 27) - 24);
	return [(texel & 511) * unit, ((texel >>> 9) & 511) * unit, ((texel >>> 18) & 511) * unit];
}

/** A half float's value. */
export function fromHalf(bits: number): number {
	const exponent = (bits >> 10) & 0x1f;
	const fraction = bits & 0x3ff;
	const sign = bits & 0x8000 ? -1 : 1;
	if (exponent === 0) return sign * fraction * 2 ** -24;
	if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
	return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/** The light of one texel of a level. */
export function texel(
	file: Uint8Array,
	env: EnvironmentFile,
	level: number,
	face: number,
	x: number,
	y: number,
): Rgb {
	const size = env.size >> level;
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const index = (face * size + y) * size + x;
	const { offset } = env.levels[level] as { offset: number };
	if (env.vkFormat === 123) return fromRgb9e5(view.getUint32(offset + 4 * index, true));
	const at = offset + 8 * index;
	return [0, 2, 4].map((k) => fromHalf(view.getUint16(at + k, true))) as Rgb;
}

/** Bilinear filtering within one face of a level, clamped at the face's edges. */
function bilinear(
	file: Uint8Array,
	env: EnvironmentFile,
	level: number,
	d: readonly number[],
): Rgb {
	const size = env.size >> level;
	const [face, s, t] = faceCoords(d);
	const fx = Math.min(Math.max(s * size - 0.5, 0), size - 1);
	const fy = Math.min(Math.max(t * size - 0.5, 0), size - 1);
	const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
	const [x1, y1] = [Math.min(x0 + 1, size - 1), Math.min(y0 + 1, size - 1)];
	const [wx, wy] = [fx - x0, fy - y0];
	const a = texel(file, env, level, face, x0, y0);
	const b = texel(file, env, level, face, x1, y0);
	const c = texel(file, env, level, face, x0, y1);
	const e = texel(file, env, level, face, x1, y1);
	return [0, 1, 2].map(
		(k) =>
			((a[k] as number) * (1 - wx) + (b[k] as number) * wx) * (1 - wy) +
			((c[k] as number) * (1 - wx) + (e[k] as number) * wx) * wy,
	) as Rgb;
}

/** The light in a direction at a level of detail, where 0 is the largest level. */
export function sampleEnvironment(
	file: Uint8Array,
	env: EnvironmentFile,
	d: readonly number[],
	lod: number,
): Rgb {
	const last = env.levels.length - 1;
	const clamped = Math.min(Math.max(lod, 0), last);
	const low = Math.floor(clamped);
	const blend = clamped - low;
	const a = bilinear(file, env, low, d);
	if (blend === 0) return a;
	const b = bilinear(file, env, low + 1, d);
	return [0, 1, 2].map((k) => (a[k] as number) * (1 - blend) + (b[k] as number) * blend) as Rgb;
}

/**
 * The level of detail that holds a perceptual roughness: the place of the roughness among the
 * levels' roughness values, blended linearly between two levels.
 */
export function roughnessLod(env: EnvironmentFile, roughness: number): number {
	const r = env.roughness;
	for (let i = 1; i < r.length; i++)
		if (roughness <= (r[i] as number))
			return i - 1 + (roughness - (r[i - 1] as number)) / ((r[i] as number) - (r[i - 1] as number));
	return r.length - 1;
}

/** The irradiance at a unit normal from the nine coefficients, as the engine's `sh_irradiance`. */
export function shIrradiance(sh: readonly number[], [x, y, z]: readonly number[]): Rgb {
	const [nx, ny, nz] = [x as number, y as number, z as number];
	const weights = [
		0.886227,
		2 * 0.511664 * ny,
		2 * 0.511664 * nz,
		2 * 0.511664 * nx,
		2 * 0.429043 * nx * ny,
		2 * 0.429043 * ny * nz,
		0.743125 * nz * nz - 0.247708,
		2 * 0.429043 * nx * nz,
		0.429043 * (nx * nx - ny * ny),
	];
	return [0, 1, 2].map((c) =>
		weights.reduce((sum, w, i) => sum + w * (sh[3 * i + c] as number), 0),
	) as Rgb;
}

/** The average light over all directions, from the first coefficient: its luminance. */
export function averageLight(sh: readonly number[]): number {
	const [r, g, b] = [0, 1, 2].map((c) => (sh[c] as number) * 0.282095) as Rgb;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The GGX roughness whose filtered light best matches three.js's PMREMGenerator at each material
 * roughness from 0 to 1, in steps of 0.05. three.js's PMREM blurs less than the GGX distribution
 * of its own materials: it reads a sharper level for each roughness. The figures come from the
 * parity test with NULL3D_ENV_PARITY_FIT=1, on two Poly Haven files, and D-19 records them.
 */
export const THREE_PMREM_ROUGHNESS = [
	0, 0, 0.07, 0.12, 0.19, 0.23, 0.255, 0.3, 0.345, 0.375, 0.41, 0.45, 0.5, 0.54, 0.61, 0.695, 0.775,
	0.825, 0.875, 0.93, 0.98,
];

/** The GGX roughness that matches three.js's PMREM at a material roughness, between the steps. */
export function threePmremRoughness(roughness: number): number {
	const table = THREE_PMREM_ROUGHNESS;
	const at = Math.min(Math.max(roughness, 0), 1) * (table.length - 1);
	const low = Math.min(Math.floor(at), table.length - 2);
	const blend = at - low;
	return (table[low] as number) * (1 - blend) + (table[low + 1] as number) * blend;
}

/** How far a level of a map lies from the same level of another, after tone mapping. */
export interface LevelDifference {
	/** The mean and the 99th percentile of the steps of 1/255 between their channels. */
	mean: number;
	p99: number;
	/** The total light of the level over the other's. */
	ratio: number;
}

/**
 * Compares each level of a map that a page made, as shared-exponent texels, with the same level of
 * the asset tool's map, after `tone` turns each channel's light into steps of 1/255.
 */
export function compareLevels(
	levels: readonly Uint32Array[],
	tool: Uint8Array,
	env: EnvironmentFile,
	tone: (light: number) => number,
): LevelDifference[] {
	return levels.map((ours, level) => {
		const { offset, length } = env.levels[level] as { offset: number; length: number };
		const bytes = tool.slice(offset, offset + length);
		const theirs = new Uint32Array(bytes.buffer);
		if (ours.length !== theirs.length)
			throw new Error(`level ${level} holds ${ours.length} texels, not ${theirs.length}`);
		const steps = new Float64Array(3 * ours.length);
		let [sumOurs, sumTheirs] = [0, 0];
		for (let k = 0; k < ours.length; k++) {
			const a = fromRgb9e5(ours[k] as number);
			const b = fromRgb9e5(theirs[k] as number);
			for (let c = 0; c < 3; c++) {
				steps[3 * k + c] = Math.abs(tone(a[c] as number) - tone(b[c] as number));
				sumOurs += a[c] as number;
				sumTheirs += b[c] as number;
			}
		}
		const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
		const p99 = steps.sort()[Math.floor(0.99 * (steps.length - 1))] as number;
		return { mean, p99, ratio: sumOurs / sumTheirs };
	});
}

/**
 * Reinhard's operator at an exposure that puts the average light of the nine coefficients at a
 * third of white, in steps of 1/255: tone mapping first makes a sun count as much as it shows.
 */
export function reinhardSteps(sh: readonly number[]): (light: number) => number {
	const exposure = 0.5 / averageLight(sh);
	return (x) => (255 * x * exposure) / (1 + x * exposure);
}

/** The shared-exponent texels of a level that a page sent as base64. */
export function words(base64: string): Uint32Array {
	const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
	return new Uint32Array(bytes.buffer);
}
