// The cases of the shader library test: each library function with sample inputs, and a reference
// in TypeScript for its results. The library test shader (`test_library.wgsl`) numbers the
// functions in the same order as `FUNCTIONS`, and a unit test checks that the two agree.
//
// A case's inputs are eight texels of four 32-bit values, and its results are sixteen values, four
// per texel, as the test shader lays them out. The references compute in 64-bit floats. A GPU
// computes in 32-bit floats, and its built-in functions such as `pow` and `sin` may differ from
// exact results by a few units, so float results must agree within a tolerance. Hashes are
// whole numbers and must agree bit for bit.
import {
	FOG_CURVE_EXP2,
	FOG_CURVE_EXPONENTIAL,
	FOG_CURVE_LINEAR,
	FOG_CURVE_NONE,
} from '../../../packages/engine/src/generated/core.ts';
import { linearToSrgb, srgbToLinear } from '../../../packages/engine/src/math/color.ts';
import { inverseLerp, mapLinear, smoothstep } from '../../../packages/engine/src/math/math.ts';
import { setAxisAngle } from '../../../packages/engine/src/math/quat.ts';
import { transformQuat } from '../../../packages/engine/src/math/vec3.ts';
import { dfgLut } from './dfg-table.ts';

type V2 = [number, number];
type V3 = [number, number, number];
type V4 = [number, number, number, number];

/** Input texels per case, after the texel that holds the function number. */
export const INPUT_TEXELS = 8;
/** Results per case: four texels of four values. */
export const RESULT_VALUES = 16;

/** One case's inputs, as floats or as whole numbers that share the same bits. */
export class Inputs {
	readonly bits = new Uint32Array(INPUT_TEXELS * 4);
	private readonly floats = new Float32Array(this.bits.buffer);

	/** Writes floats into a texel, from its first value on. */
	setF(texel: number, values: readonly number[]): this {
		this.floats.set(values, texel * 4);
		return this;
	}

	/** Writes whole numbers into a texel, from its first value on. */
	setU(texel: number, values: readonly number[]): this {
		this.bits.set(
			values.map((v) => v >>> 0),
			texel * 4,
		);
		return this;
	}

	/** A texel as floats. */
	f(texel: number): V4 {
		const at = texel * 4;
		return [this.floats[at]!, this.floats[at + 1]!, this.floats[at + 2]!, this.floats[at + 3]!];
	}

	/** A texel as whole numbers. */
	u(texel: number): V4 {
		const at = texel * 4;
		return [this.bits[at]!, this.bits[at + 1]!, this.bits[at + 2]!, this.bits[at + 3]!];
	}
}

/** Results in the shader's layout, and whether they are whole numbers. */
export interface Expected {
	values: number[];
	whole: boolean;
}

/** A library function, the inputs of its cases, and its reference. */
export interface LibraryFunction {
	/** The function's path in the library, such as `math::square`. */
	name: string;
	/** Each case's inputs, from a random number generator that the test seeds. */
	cases(random: () => number): Inputs[];
	/** The results the function must give for a case's inputs. */
	expected(i: Inputs): Expected;
	/**
	 * The largest difference allowed, relative to the expected value or to 1, whichever is larger.
	 * Whole numbers must match exactly.
	 */
	tolerance?: number;
}

/** The tolerance of most float results. */
export const DEFAULT_TOLERANCE = 1e-4;
/**
 * The tolerance of results that go through `sin` and `cos`, which WGSL lets a GPU compute to within
 * 2^-11 of the exact value.
 */
const TRIG_TOLERANCE = 2e-3;
/** Cases per function, besides any fixed ones. */
const SAMPLES = 4;

// Results in the shader's layout.

const pad = (values: readonly number[]) => [...values, 0, 0, 0, 0].slice(0, 4);
const floats = (...rows: (readonly number[])[]): Expected => ({
	values: [...rows, [], [], [], []].slice(0, 4).flatMap(pad),
	whole: false,
});
const whole = (values: readonly number[]): Expected => ({
	values: [...pad(values), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	whole: true,
});
const scalar = (x: number) => floats([x]);

// Vector math on tuples, as WGSL defines it.

const xyz = (v: V4): V3 => [v[0], v[1], v[2]];
const xy = (v: V4): V2 => [v[0], v[1]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const mul = (a: V3, b: V3): V3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const map3 = (a: V3, f: (x: number) => number): V3 => [f(a[0]), f(a[1]), f(a[2])];
const dot = (a: readonly number[], b: readonly number[]) =>
	a.reduce((sum, x, k) => sum + x * (b[k] ?? 0), 0);
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const length = (a: readonly number[]) => Math.sqrt(dot(a, a));
const normalize = (a: V3): V3 => scale(a, 1 / length(a));
const saturate = (x: number) => Math.min(Math.max(x, 0), 1);
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [
	mix(a[0], b[0], t),
	mix(a[1], b[1], t),
	mix(a[2], b[2], t),
];
const fract = (x: number) => x - Math.floor(x);
/** A 3 x 3 matrix, given by columns, times a vector. */
const mat3 = (m: readonly V3[], v: V3): V3 =>
	add(add(scale(m[0]!, v[0]), scale(m[1]!, v[1])), scale(m[2]!, v[2]));
/** GLSL's `smoothstep(low, high, x)`, which the engine's `smoothstep(x, low, high)` matches. */
const smooth = (low: number, high: number, x: number) => smoothstep(x, low, high);

// Random inputs.

/** Mulberry32: a small seeded generator, so every run tests the same inputs. */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const between = (random: () => number, low: number, high: number) =>
	Math.fround(low + (high - low) * random());
const values = (random: () => number, count: number, low: number, high: number) =>
	Array.from({ length: count }, () => between(random, low, high));
const unit = (random: () => number): V3 => {
	for (;;) {
		const v: V3 = [between(random, -1, 1), between(random, -1, 1), between(random, -1, 1)];
		const l = length(v);
		if (l > 0.2 && l < 1) return map3(v, (x) => Math.fround(x / l));
	}
};
/** `SAMPLES` cases, each from one call of `make`. */
const samples =
	(make: (random: () => number) => Inputs) =>
	(random: () => number): Inputs[] =>
		Array.from({ length: SAMPLES }, () => make(random));
/** Cases whose first texel holds `count` floats from `low` to `high`. */
const uniform = (count: number, low: number, high: number) =>
	samples((random) => new Inputs().setF(0, values(random, count, low, high)));

/**
 * A fractal noise case with many octaves near the origin, where the last octave's point stays
 * small enough for 32-bit floats to keep its noise exact. It reaches octave scales up to 2^7.
 */
const MANY_OCTAVES = 8;
const MANY_OCTAVES_POINT = [0.37, -0.81, 0.52];
/**
 * An octave count past the most that the library sums. The octaves it leaves out change the result
 * by far less than the tolerance, so the reference, which sums them all, still holds.
 */
const TOO_MANY_OCTAVES = 40;

// References for null3d::noise, in 32-bit whole numbers.

function pcg(v: number): number {
	const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
	const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

function pcg3d(v: readonly number[]): V3 {
	let x = (Math.imul(v[0]!, 1664525) + 1013904223) >>> 0;
	let y = (Math.imul(v[1]!, 1664525) + 1013904223) >>> 0;
	let z = (Math.imul(v[2]!, 1664525) + 1013904223) >>> 0;
	x = (x + Math.imul(y, z)) >>> 0;
	y = (y + Math.imul(z, x)) >>> 0;
	z = (z + Math.imul(x, y)) >>> 0;
	x = (x ^ (x >>> 16)) >>> 0;
	y = (y ^ (y >>> 16)) >>> 0;
	z = (z ^ (z >>> 16)) >>> 0;
	x = (x + Math.imul(y, z)) >>> 0;
	y = (y + Math.imul(z, x)) >>> 0;
	z = (z + Math.imul(x, y)) >>> 0;
	return [x, y, z];
}

const toUnit = (h: number) => (h >>> 8) / 16777216;
const floatBits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]!;
const lattice = (c: V3) => pcg3d(c.map((k) => k >>> 0));
const floor3 = (p: V3): V3 => map3(p, Math.floor);
const fract3 = (p: V3): V3 => map3(p, fract);
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function gradient(h: number, f: V3): number {
	const k = h & 15;
	const u = k < 8 ? f[0] : f[1];
	const v = k < 4 ? f[1] : k === 12 || k === 14 ? f[0] : f[2];
	return ((k & 1) === 0 ? u : -u) + ((k & 2) === 0 ? v : -v);
}

/** The corners of a lattice cell in the order the shader blends them: x fastest, then y, then z. */
function blendCorners(
	p: V3,
	dimensions: 2 | 3,
	corner: (c: V3, f: V3) => number,
	curve: (t: number) => number,
): number {
	const i = floor3(p);
	const f = fract3(p);
	const u = map3(f, curve);
	const at = (dx: number, dy: number, dz: number) =>
		corner([i[0] + dx, i[1] + dy, i[2] + dz], [f[0] - dx, f[1] - dy, f[2] - dz]);
	const row = (dy: number, dz: number) => mix(at(0, dy, dz), at(1, dy, dz), u[0]);
	const plane = (dz: number) => mix(row(0, dz), row(1, dz), u[1]);
	return dimensions === 2 ? plane(0) : mix(plane(0), plane(1), u[2]);
}

const value = (p: V3, dimensions: 2 | 3) =>
	blendCorners(p, dimensions, (c) => toUnit(lattice(c)[0]), fade);
const perlin = (p: V3, dimensions: 2 | 3) =>
	blendCorners(p, dimensions, (c, f) => gradient(lattice(c)[0], f), fade);

function simplexCorner(c: V3, x: V3, r2: number): number {
	const t = Math.max(r2 - dot(x, x), 0);
	return t * t * t * t * gradient(lattice(c)[0], x);
}

function simplex3(p: V3): number {
	const skew = (p[0] + p[1] + p[2]) / 3;
	const cell = map3(p, (x) => Math.floor(x + skew));
	const unskew = (cell[0] + cell[1] + cell[2]) / 6;
	const x0 = map3(sub(p, cell), (x) => x + unskew);
	const g: V3 = [x0[1] <= x0[0] ? 1 : 0, x0[2] <= x0[1] ? 1 : 0, x0[0] <= x0[2] ? 1 : 0];
	const l = map3(g, (x) => 1 - x);
	const i1: V3 = [Math.min(g[0], l[2]), Math.min(g[1], l[0]), Math.min(g[2], l[1])];
	const i2: V3 = [Math.max(g[0], l[2]), Math.max(g[1], l[0]), Math.max(g[2], l[1])];
	const x1 = map3(sub(x0, i1), (x) => x + 1 / 6);
	const x2 = map3(sub(x0, i2), (x) => x + 1 / 3);
	const x3 = map3(x0, (x) => x - 0.5);
	const n =
		simplexCorner(cell, x0, 0.6) +
		simplexCorner(add(cell, i1), x1, 0.6) +
		simplexCorner(add(cell, i2), x2, 0.6) +
		simplexCorner(add(cell, [1, 1, 1]), x3, 0.6);
	return 32 * n;
}

function simplex2(p: V2): number {
	const skew = (p[0] + p[1]) * 0.36602540378443865;
	const cell: V3 = [Math.floor(p[0] + skew), Math.floor(p[1] + skew), 0];
	const unskew = (cell[0] + cell[1]) * 0.21132486540518713;
	const x0: V3 = [p[0] - (cell[0] - unskew), p[1] - (cell[1] - unskew), 0];
	const i1: V3 = x0[0] > x0[1] ? [1, 0, 0] : [0, 1, 0];
	const x1: V3 = [x0[0] - i1[0] + 0.21132486540518713, x0[1] - i1[1] + 0.21132486540518713, 0];
	const x2: V3 = [x0[0] - 1 + 0.42264973081037427, x0[1] - 1 + 0.42264973081037427, 0];
	const n =
		simplexCorner(cell, x0, 0.5) +
		simplexCorner(add(cell, i1), x1, 0.5) +
		simplexCorner(add(cell, [1, 1, 0]), x2, 0.5);
	return 70 * n;
}

function worley(p: V3, dimensions: 2 | 3): number {
	const i = floor3(p);
	const f = fract3(p);
	let nearest = 8;
	for (let z = dimensions === 3 ? -1 : 0; z <= (dimensions === 3 ? 1 : 0); z++)
		for (let y = -1; y <= 1; y++)
			for (let x = -1; x <= 1; x++) {
				const o: V3 = [x, y, z];
				const h = lattice(add(i, o));
				const point = map3([0, 1, 2] as V3, (k) => (h[k]! >>> 8) / 16777216);
				const d = sub(add(o, point), f);
				if (dimensions === 2) d[2] = 0;
				nearest = Math.min(nearest, dot(d, d));
			}
	return Math.sqrt(nearest);
}

function fbm(noise: (p: V3) => number, p: V3, octaves: number): number {
	let sum = 0;
	let total = 0;
	let amplitude = 1;
	let q = p;
	for (let octave = 0; octave < octaves; octave++) {
		sum += amplitude * noise(q);
		total += amplitude;
		amplitude *= 0.5;
		q = scale(q, 2);
	}
	return total > 0 ? sum / total : 0;
}

// References for null3d::color.

const ACES_INPUT: V3[] = [
	[0.59719, 0.076, 0.0284],
	[0.35458, 0.90834, 0.13383],
	[0.04823, 0.01566, 0.83777],
];
const ACES_OUTPUT: V3[] = [
	[1.60475, -0.10208, -0.00327],
	[-0.53108, 1.10813, -0.07276],
	[-0.07367, -0.00605, 1.07602],
];
const REC2020_TO_SRGB: V3[] = [
	[1.6605, -0.1246, -0.0182],
	[-0.5876, 1.1329, -0.1006],
	[-0.0728, -0.0083, 1.1187],
];
const SRGB_TO_REC2020: V3[] = [
	[0.6274, 0.0691, 0.0164],
	[0.3293, 0.9195, 0.088],
	[0.0433, 0.0113, 0.8956],
];
const AGX_INSET: V3[] = [
	[0.856627153315983, 0.137318972929847, 0.11189821299995],
	[0.0951212405381588, 0.761241990602591, 0.0767994186031903],
	[0.0482516061458583, 0.101439036467562, 0.811302368396859],
];
const AGX_OUTSET: V3[] = [
	[1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
	[-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
	[-0.016493938717834573, -0.016493938717834257, 1.2519364065950405],
];
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;

const rrtAndOdtFit = (v: V3) =>
	map3(v, (x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
const acesFilmic = (c: V3) =>
	map3(mat3(ACES_OUTPUT, rrtAndOdtFit(mat3(ACES_INPUT, scale(c, 1 / 0.6)))), saturate);
const agxContrast = (v: V3) =>
	map3(v, (x) => {
		const x2 = x * x;
		const x4 = x2 * x2;
		return (
			15.5 * x4 * x2 -
			40.14 * x4 * x +
			31.96 * x4 -
			6.868 * x2 * x +
			0.4298 * x2 +
			0.1191 * x -
			0.00232
		);
	});
function agx(c: V3): V3 {
	const inset = mat3(AGX_INSET, mat3(SRGB_TO_REC2020, c));
	const logged = map3(
		inset,
		(x) => (Math.log2(Math.max(x, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV),
	);
	const curved = mat3(AGX_OUTSET, agxContrast(map3(logged, saturate)));
	return map3(
		mat3(
			REC2020_TO_SRGB,
			map3(curved, (x) => Math.max(x, 0) ** 2.2),
		),
		saturate,
	);
}
function neutral(c: V3): V3 {
	const start = 0.8 - 0.04;
	const x = Math.min(...c);
	const toe = x < 0.08 ? x - 6.25 * x * x : 0.04;
	const shifted = map3(c, (v) => v - toe);
	const peak = Math.max(...shifted);
	if (peak < start) return shifted;
	const d = 1 - start;
	const newPeak = 1 - (d * d) / (peak + d - start);
	const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
	return mix3(scale(shifted, newPeak / peak), [newPeak, newPeak, newPeak], g);
}
function rgbToHsv([r, g, b]: V3): V3 {
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	let h = 0;
	if (d > 0) {
		if (max === r) h = (g - b) / d / 6;
		else if (max === g) h = ((b - r) / d + 2) / 6;
		else h = ((r - g) / d + 4) / 6;
	}
	return [fract(h + 1), d / max, max];
}
function hsvToRgb([h, s, v]: V3): V3 {
	const channel = (k: number) => {
		const p = Math.abs(fract(h + k) * 6 - 3);
		return v * mix(1, saturate(p - 1), s);
	};
	return [channel(1), channel(2 / 3), channel(1 / 3)];
}

// References for null3d::lighting, after three.js's physical lighting.

const INV_PI = 1 / Math.PI;
const fSchlick = (f0: V3, f90: number, vDotH: number) => {
	const fresnel = 2 ** ((-5.55473 * vDotH - 6.98316) * vDotH);
	return map3(f0, (f) => f * (1 - fresnel) + f90 * fresnel);
};
const dGgx = (alpha: number, nDotH: number) => {
	const a2 = alpha * alpha;
	const denom = nDotH * nDotH * (a2 - 1) + 1;
	return (INV_PI * a2) / (denom * denom);
};
const vGgx = (alpha: number, nDotL: number, nDotV: number) => {
	const a2 = alpha * alpha;
	const gv = nDotL * Math.sqrt(a2 + (1 - a2) * nDotV * nDotV);
	const gl = nDotV * Math.sqrt(a2 + (1 - a2) * nDotL * nDotL);
	return 0.5 / Math.max(gv + gl, 1e-6);
};
function brdfGgx(toLight: V3, toView: V3, normal: V3, f0: V3, f90: number, roughness: number): V3 {
	const alpha = roughness * roughness;
	const half = normalize(add(toLight, toView));
	const nDotL = saturate(dot(normal, toLight));
	const nDotV = saturate(dot(normal, toView));
	const nDotH = saturate(dot(normal, half));
	const vDotH = saturate(dot(toView, half));
	return scale(fSchlick(f0, f90, vDotH), vGgx(alpha, nDotL, nDotV) * dGgx(alpha, nDotH));
}
function multiscattering(f0: V3, f90: number, dfg: V2): [V3, V3] {
	const single = map3(f0, (f) => f * dfg[0] + f90 * dfg[1]);
	const ems = 1 - (dfg[0] + dfg[1]);
	const multi = map3([0, 1, 2] as V3, (k) => {
		const average = f0[k]! + (1 - f0[k]!) * 0.047619;
		return ((single[k]! * average) / (1 - ems * average)) * ems;
	});
	return [single, multi];
}
interface Pbr {
	base: V3;
	diffuse: V3;
	specular: V3;
	blended: V3;
	grazing: number;
	roughness: number;
	metalness: number;
}
function pbrMaterial(base: V3, metalness: number, roughness: number, geometry: number): Pbr {
	const specular: V3 = [0.04, 0.04, 0.04];
	return {
		base,
		diffuse: scale(base, 1 - metalness),
		specular,
		blended: mix3(specular, base, metalness),
		grazing: 1,
		roughness: Math.min(Math.max(roughness, 0.0525) + geometry, 1),
		metalness,
	};
}
/** The material that the test shader's cases build from the first two texels. */
const materialOf = (i: Inputs) => {
	const [r, g, b, metalness] = i.f(0);
	const [roughness, geometry] = i.f(1);
	return pbrMaterial([r, g, b], metalness, roughness, geometry);
};
/** Inputs whose first two texels make a material, and whose later texels hold unit directions. */
const materialCase =
	(fill: (random: () => number, i: Inputs) => void) =>
	(random: () => number): Inputs[] =>
		Array.from({ length: SAMPLES }, () => {
			const i = new Inputs()
				.setF(0, [...values(random, 3, 0, 1), between(random, 0, 1)])
				.setF(1, [between(random, 0, 1), between(random, 0, 0.2)]);
			fill(random, i);
			return i;
		});

// References for null3d::vertex, with a transform as three rows.

const rows = (i: Inputs): V4[] => [i.f(0), i.f(1), i.f(2)];
const transformPoint = (t: V4[], p: V3): V3 => map3([0, 1, 2] as V3, (k) => dot(t[k]!, [...p, 1]));
/** Random transforms: rotation and uneven scale, sometimes a mirror, and a translation. */
const transformCase = (random: () => number) =>
	samples((r) => {
		const i = new Inputs();
		for (let k = 0; k < 3; k++) i.setF(k, values(r, 4, -2, 2));
		return i.setF(3, values(r, 3, -3, 3));
	})(random);

/** Every library function in the test shader's order. */
export const FUNCTIONS: readonly LibraryFunction[] = [
	// null3d::math
	{
		name: 'math::square',
		cases: uniform(1, -10, 10),
		expected: (i) => scalar(i.f(0)[0] ** 2),
	},
	{
		name: 'math::max_component',
		cases: uniform(3, -5, 5),
		expected: (i) => scalar(Math.max(...xyz(i.f(0)))),
	},
	{
		name: 'math::min_component',
		cases: uniform(3, -5, 5),
		expected: (i) => scalar(Math.min(...xyz(i.f(0)))),
	},
	{
		name: 'math::inverse_lerp',
		cases: uniform(3, -5, 5),
		expected: (i) => {
			const [a, b, x] = i.f(0);
			return scalar(inverseLerp(a, b, x));
		},
		tolerance: 1e-3,
	},
	{
		name: 'math::remap',
		cases: samples((random) =>
			new Inputs()
				.setF(0, [between(random, -2, 2), -3, 3, between(random, -10, 0)])
				.setF(1, [between(random, 1, 10)]),
		),
		expected: (i) => {
			const [x, a1, a2, b1] = i.f(0);
			return scalar(mapLinear(x, a1, a2, b1, i.f(1)[0]));
		},
	},
	{
		name: 'math::modulo',
		cases: (random) => [
			new Inputs().setF(0, [-0.25, 1]),
			new Inputs().setF(0, [0.25, -1]),
			...samples((r) => new Inputs().setF(0, [between(r, -10, 10), between(r, 0.5, 3)]))(random),
		],
		expected: (i) => {
			const [x, y] = i.f(0);
			return scalar(x - y * Math.floor(x / y));
		},
	},
	{
		name: 'math::rotate_2d',
		cases: uniform(3, -3, 3),
		expected: (i) => {
			const [x, y, angle] = i.f(0);
			const c = Math.cos(angle);
			const s = Math.sin(angle);
			return floats([c * x - s * y, s * x + c * y]);
		},
		tolerance: TRIG_TOLERANCE,
	},
	{
		name: 'math::rotate_axis',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, -2, 2))
				.setF(1, [...unit(random), between(random, -3, 3)]),
		),
		expected: (i) => {
			const [ax, ay, az, angle] = i.f(1);
			const q = setAxisAngle([0, 0, 0, 1], [ax, ay, az], angle);
			return floats(transformQuat([0, 0, 0], xyz(i.f(0)), q));
		},
		tolerance: TRIG_TOLERANCE,
	},
	{
		name: 'math::quat_rotate',
		cases: samples((random) => {
			const [x, y, z] = unit(random);
			const half = between(random, -1.5, 1.5);
			const s = Math.sin(half);
			return new Inputs()
				.setF(0, [x * s, y * s, z * s, Math.cos(half)])
				.setF(1, values(random, 3, -2, 2));
		}),
		expected: (i) => floats(transformQuat([0, 0, 0], xyz(i.f(1)), i.f(0))),
	},
	{
		name: 'math::basis_from_normal',
		cases: (random) => [
			new Inputs().setF(0, [0, 0, 1]),
			new Inputs().setF(0, [0, 0, -1]),
			...samples((r) => new Inputs().setF(0, unit(r)))(random),
		],
		expected: (i) => {
			const [x, y, z] = xyz(i.f(0));
			const s = z >= 0 ? 1 : -1;
			const a = -1 / (s + z);
			const b = x * y * a;
			return floats([1 + s * x * x * a, s * b, -s * x], [b, s + y * y * a, -y], [x, y, z]);
		},
	},
	{
		name: 'math::PI',
		cases: () => [new Inputs()],
		expected: () => floats([Math.PI, 2 * Math.PI, Math.PI / 2, 1 / Math.PI], [1e-6]),
		tolerance: 0,
	},
	// null3d::noise
	{
		name: 'noise::pcg',
		cases: (random) =>
			[0, 1, 0xffffffff, ...values(random, SAMPLES, 0, 2 ** 32)].map((v) =>
				new Inputs().setU(0, [v]),
			),
		expected: (i) => whole([pcg(i.u(0)[0])]),
	},
	{
		name: 'noise::pcg3d',
		cases: samples((random) => new Inputs().setU(0, values(random, 3, 0, 2 ** 32))),
		expected: (i) => whole(pcg3d(i.u(0))),
	},
	{
		name: 'noise::to_unit',
		cases: (random) =>
			[0, 0xffffffff, ...values(random, SAMPLES, 0, 2 ** 32)].map((v) => new Inputs().setU(0, [v])),
		expected: (i) => scalar(toUnit(i.u(0)[0])),
		tolerance: 0,
	},
	{
		name: 'noise::random',
		cases: samples((random) => new Inputs().setU(0, [between(random, 0, 1e6)])),
		expected: (i) => scalar(toUnit(pcg(i.u(0)[0]))),
		tolerance: 0,
	},
	{
		name: 'noise::random2',
		cases: uniform(2, -100, 100),
		expected: (i) => {
			const [x, y] = i.f(0);
			return scalar(toUnit(pcg((floatBits(x) ^ pcg(floatBits(y))) >>> 0)));
		},
		tolerance: 0,
	},
	{
		name: 'noise::random3',
		cases: uniform(3, -100, 100),
		expected: (i) => scalar(toUnit(pcg3d(xyz(i.f(0)).map(floatBits))[0])),
		tolerance: 0,
	},
	{
		name: 'noise::lattice',
		cases: samples((random) =>
			new Inputs().setU(0, values(random, 3, -1000, 1000).map(Math.round)),
		),
		expected: (i) => whole(pcg3d(i.u(0))),
	},
	{
		name: 'noise::fade',
		cases: uniform(3, 0, 1),
		expected: (i) => floats(map3(xyz(i.f(0)), fade)),
	},
	{
		name: 'noise::value3',
		cases: uniform(3, -50, 50),
		expected: (i) => scalar(value(xyz(i.f(0)), 3)),
	},
	{
		name: 'noise::value2',
		cases: uniform(2, -50, 50),
		expected: (i) => scalar(value([...xy(i.f(0)), 0], 2)),
	},
	{
		name: 'noise::gradient',
		cases: (random) =>
			Array.from({ length: 16 }, (_, k) =>
				new Inputs().setU(0, [k]).setF(1, values(random, 3, -1, 1)),
			),
		expected: (i) => scalar(gradient(i.u(0)[0], xyz(i.f(1)))),
	},
	{
		name: 'noise::perlin3',
		cases: uniform(3, -50, 50),
		expected: (i) => scalar(perlin(xyz(i.f(0)), 3)),
	},
	{
		name: 'noise::perlin2',
		cases: uniform(2, -50, 50),
		expected: (i) => scalar(perlin([...xy(i.f(0)), 0], 2)),
	},
	{
		name: 'noise::simplex_corner',
		cases: samples((random) =>
			new Inputs()
				.setU(0, values(random, 3, -100, 100).map(Math.round))
				.setF(1, [...values(random, 3, -0.6, 0.6), 0.6]),
		),
		expected: (i) => {
			const [x, y, z, r2] = i.f(1);
			return scalar(
				simplexCorner(
					i
						.u(0)
						.slice(0, 3)
						.map((k) => k | 0) as V3,
					[x, y, z],
					r2,
				),
			);
		},
	},
	{
		name: 'noise::simplex3',
		cases: uniform(3, -50, 50),
		expected: (i) => scalar(simplex3(xyz(i.f(0)))),
	},
	{
		name: 'noise::simplex2',
		cases: uniform(2, -50, 50),
		expected: (i) => scalar(simplex2(xy(i.f(0)))),
	},
	{
		name: 'noise::worley3',
		cases: uniform(3, -50, 50),
		expected: (i) => scalar(worley(xyz(i.f(0)), 3)),
	},
	{
		name: 'noise::worley2',
		cases: uniform(2, -50, 50),
		expected: (i) => scalar(worley([...xy(i.f(0)), 0], 2)),
	},
	{
		name: 'noise::fbm3',
		cases: (random) => [
			...[0, 1, 3, 5].map((octaves) =>
				new Inputs().setF(0, values(random, 3, -20, 20)).setU(1, [octaves]),
			),
			new Inputs().setF(0, MANY_OCTAVES_POINT).setU(1, [MANY_OCTAVES]),
			new Inputs().setF(0, MANY_OCTAVES_POINT).setU(1, [TOO_MANY_OCTAVES]),
		],
		expected: (i) => scalar(fbm(simplex3, xyz(i.f(0)), i.u(1)[0])),
	},
	{
		name: 'noise::fbm2',
		cases: (random) => [
			...[0, 1, 3, 5].map((octaves) =>
				new Inputs().setF(0, values(random, 2, -20, 20)).setU(1, [octaves]),
			),
			new Inputs().setF(0, MANY_OCTAVES_POINT).setU(1, [MANY_OCTAVES]),
			new Inputs().setF(0, MANY_OCTAVES_POINT).setU(1, [TOO_MANY_OCTAVES]),
		],
		expected: (i) => scalar(fbm((p) => simplex2(xy([...p, 0])), [...xy(i.f(0)), 0], i.u(1)[0])),
	},
	// null3d::color
	{
		name: 'color::linear_to_srgb',
		cases: (random) => [new Inputs().setF(0, [0, 0.002, 1]), ...uniform(3, 0, 1)(random)],
		expected: (i) => floats(map3(xyz(i.f(0)), linearToSrgb)),
	},
	{
		name: 'color::srgb_to_linear',
		cases: (random) => [new Inputs().setF(0, [0, 0.03, 1]), ...uniform(3, 0, 1)(random)],
		expected: (i) => floats(map3(xyz(i.f(0)), srgbToLinear)),
	},
	{
		name: 'color::luminance',
		cases: uniform(3, 0, 2),
		expected: (i) => scalar(dot(xyz(i.f(0)), [0.2126, 0.7152, 0.0722])),
	},
	{
		name: 'color::rgb_to_hsv',
		cases: uniform(3, 0.1, 1),
		expected: (i) => floats(rgbToHsv(xyz(i.f(0)))),
	},
	{
		name: 'color::hsv_to_rgb',
		cases: uniform(3, 0, 1),
		expected: (i) => floats(hsvToRgb(xyz(i.f(0)))),
	},
	{
		name: 'color::rrt_and_odt_fit',
		cases: uniform(3, 0, 8),
		expected: (i) => floats(rrtAndOdtFit(xyz(i.f(0)))),
	},
	{
		name: 'color::tone_map_aces',
		cases: uniform(3, 0, 8),
		expected: (i) => floats(acesFilmic(xyz(i.f(0)))),
	},
	{
		name: 'color::agx_contrast',
		cases: uniform(3, 0, 1),
		expected: (i) => floats(agxContrast(xyz(i.f(0)))),
	},
	{
		name: 'color::tone_map_agx',
		cases: uniform(3, 0.01, 8),
		expected: (i) => floats(agx(xyz(i.f(0)))),
	},
	{
		name: 'color::tone_map_neutral',
		cases: (random) => [new Inputs().setF(0, [0.2, 0.3, 0.5]), ...uniform(3, 0, 8)(random)],
		expected: (i) => floats(neutral(xyz(i.f(0)))),
	},
	// null3d::lighting
	{
		name: 'lighting::lambert',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, 0, 1))
				.setF(1, unit(random))
				.setF(2, unit(random))
				.setF(3, values(random, 3, 0, 3))
				.setF(4, values(random, 3, 0, 0.5)),
		),
		expected: (i) => {
			const nDotL = Math.max(dot(xyz(i.f(1)), xyz(i.f(2))), 0);
			const irradiance = add(scale(xyz(i.f(3)), nDotL), xyz(i.f(4)));
			return floats(mul(scale(xyz(i.f(0)), 1 / Math.PI), irradiance));
		},
	},
	{
		name: 'lighting::brdf_lambert',
		cases: uniform(3, 0, 1),
		expected: (i) => floats(scale(xyz(i.f(0)), INV_PI)),
	},
	{
		name: 'lighting::f_schlick',
		cases: samples((random) =>
			new Inputs().setF(0, [...values(random, 3, 0, 1), 1]).setF(1, [between(random, 0, 1)]),
		),
		expected: (i) => floats(fSchlick(xyz(i.f(0)), i.f(0)[3], i.f(1)[0])),
	},
	{
		name: 'lighting::d_ggx',
		cases: samples((random) =>
			new Inputs().setF(0, [between(random, 0.05, 1), between(random, 0, 1)]),
		),
		expected: (i) => scalar(dGgx(i.f(0)[0], i.f(0)[1])),
	},
	{
		name: 'lighting::v_ggx_smith_correlated',
		cases: uniform(3, 0.05, 1),
		expected: (i) => scalar(vGgx(i.f(0)[0], i.f(0)[1], i.f(0)[2])),
	},
	{
		name: 'lighting::brdf_ggx',
		cases: samples((random) => {
			const normal = unit(random);
			const facing = (v: V3) => (dot(v, normal) < 0 ? scale(v, -1) : v);
			return new Inputs()
				.setF(0, facing(unit(random)))
				.setF(1, facing(unit(random)))
				.setF(2, normal)
				.setF(3, [...values(random, 3, 0.02, 1), 1])
				.setF(4, [between(random, 0.1, 1)]);
		}),
		expected: (i) =>
			floats(brdfGgx(xyz(i.f(0)), xyz(i.f(1)), xyz(i.f(2)), xyz(i.f(3)), i.f(3)[3], i.f(4)[0])),
	},
	{
		// three.js's table, which the page binds as the engine does: at entry centers, between
		// entries, past the edges, and at random.
		name: 'lighting::dfg_lut',
		cases: (random) => [
			new Inputs().setF(0, [0.53125, 0.21875]),
			new Inputs().setF(0, [0.5, 0.5]),
			new Inputs().setF(0, [0, 0]),
			new Inputs().setF(0, [1, 1]),
			...uniform(2, 0, 1)(random),
		],
		expected: (i) => floats(dfgLut(i.f(0)[0], i.f(0)[1])),
	},
	{
		name: 'lighting::environment_brdf',
		cases: samples((random) =>
			new Inputs().setF(0, [...values(random, 3, 0, 1), 1]).setF(1, values(random, 2, 0, 1)),
		),
		expected: (i) => {
			const [a, b] = i.f(1);
			return floats(map3(xyz(i.f(0)), (f) => f * a + i.f(0)[3] * b));
		},
	},
	{
		name: 'lighting::multiscattering',
		cases: samples((random) =>
			new Inputs()
				.setF(0, [...values(random, 3, 0, 1), 1])
				.setF(1, dfgLut(between(random, 0, 1), between(random, 0, 1))),
		),
		expected: (i) => floats(...multiscattering(xyz(i.f(0)), i.f(0)[3], xy(i.f(1)))),
	},
	{
		name: 'lighting::multiscatter_compensation',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, 0, 1))
				.setF(1, dfgLut(between(random, 0, 1), between(random, 0, 1))),
		),
		expected: (i) => {
			const [a, b] = i.f(1);
			return floats(map3(xyz(i.f(0)), (f) => 1 + f * (1 / (a + b) - 1)));
		},
	},
	{
		name: 'lighting::specular_occlusion',
		cases: uniform(3, 0, 1),
		expected: (i) => {
			const [nDotV, occlusion, roughness] = i.f(0);
			return scalar(saturate((nDotV + occlusion) ** (2 ** (-16 * roughness - 1)) - 1 + occlusion));
		},
	},
	{
		name: 'lighting::distance_attenuation',
		cases: (random) => [
			new Inputs().setF(0, [0.05, 0, 2]),
			new Inputs().setF(0, [12, 10, 2]),
			...samples((r) =>
				new Inputs().setF(0, [between(r, 0.5, 10), between(r, 0, 12), between(r, 0, 2)]),
			)(random),
		],
		expected: (i) => {
			const [distance, cutoff, decay] = i.f(0);
			let falloff = 1 / Math.max(distance ** decay, 0.01);
			if (cutoff > 0) falloff *= saturate(1 - (distance / cutoff) ** 4) ** 2;
			return scalar(falloff);
		},
	},
	{
		name: 'lighting::spot_attenuation',
		cases: samples((random) => new Inputs().setF(0, [0.7, 0.9, between(random, 0.6, 1)])),
		expected: (i) => {
			const [cone, penumbra, angle] = i.f(0);
			return scalar(smooth(cone, penumbra, angle));
		},
	},
	{
		name: 'lighting::hemisphere_irradiance',
		cases: samples((random) =>
			new Inputs()
				.setF(0, unit(random))
				.setF(1, [0, 1, 0])
				.setF(2, values(random, 3, 0, 1))
				.setF(3, values(random, 3, 0, 1)),
		),
		expected: (i) =>
			floats(mix3(xyz(i.f(3)), xyz(i.f(2)), 0.5 * dot(xyz(i.f(0)), xyz(i.f(1))) + 0.5)),
	},
	{
		name: 'lighting::sh_irradiance',
		cases: samples((random) => {
			const i = new Inputs().setF(0, unit(random));
			for (let k = 1; k < 8; k++) i.setF(k, values(random, 4, -0.5, 1));
			return i;
		}),
		expected: (i) => {
			const [x, y, z] = xyz(i.f(0));
			const packed = [1, 2, 3, 4, 5, 6, 7].flatMap((k) => i.f(k));
			const sh = (k: number): V3 => [packed[k * 3]!, packed[k * 3 + 1]!, packed[k * 3 + 2]!];
			const weights = [
				0.886227,
				2 * 0.511664 * y,
				2 * 0.511664 * z,
				2 * 0.511664 * x,
				2 * 0.429043 * x * y,
				2 * 0.429043 * y * z,
				0.743125 * z * z - 0.247708,
				2 * 0.429043 * x * z,
				0.429043 * (x * x - y * y),
			];
			return floats(weights.reduce<V3>((sum, w, k) => add(sum, scale(sh(k), w)), [0, 0, 0]));
		},
	},
	{
		name: 'lighting::pbr_material',
		cases: materialCase(() => {}),
		expected: (i) => {
			const m = materialOf(i);
			return floats(
				[...m.base, m.grazing],
				[...m.diffuse, m.roughness],
				[...m.specular, m.metalness],
				m.blended,
			);
		},
	},
	{
		name: 'lighting::direct_light',
		cases: materialCase((random, i) => {
			const normal = unit(random);
			const facing = (v: V3) => (dot(v, normal) < 0 ? scale(v, -1) : v);
			i.setF(2, normal)
				.setF(3, facing(unit(random)))
				.setF(4, facing(unit(random)))
				.setF(5, values(random, 3, 0, 3))
				.setF(6, values(random, 3, 1, 1.5));
		}),
		expected: (i) => {
			const m = materialOf(i);
			const [normal, toView, toLight, light, compensation] = [2, 3, 4, 5, 6].map((k) =>
				xyz(i.f(k)),
			);
			const irradiance = scale(light!, saturate(dot(normal!, toLight!)));
			const brdf = brdfGgx(toLight!, toView!, normal!, m.blended, m.grazing, m.roughness);
			const vDotH = saturate(dot(toView!, normalize(add(toLight!, toView!))));
			const fresnel = fSchlick(m.specular, m.grazing, vDotH);
			return floats(
				mul(
					mul(irradiance, scale(m.diffuse, INV_PI)),
					map3(fresnel, (f) => 1 - f),
				),
				mul(mul(irradiance, brdf), compensation!),
			);
		},
	},
	{
		name: 'lighting::indirect_diffuse',
		cases: materialCase((random, i) => {
			i.setF(2, values(random, 3, 0, 2)).setF(
				3,
				dfgLut(between(random, 0, 1), between(random, 0, 1)),
			);
		}),
		expected: (i) => {
			const m = materialOf(i);
			const [single, multi] = multiscattering(m.specular, m.grazing, xy(i.f(3)));
			const kept = sub(sub([1, 1, 1], single), multi);
			return floats(mul(mul(xyz(i.f(2)), scale(m.diffuse, INV_PI)), kept));
		},
	},
	{
		name: 'lighting::indirect_specular',
		cases: materialCase((random, i) => {
			i.setF(2, values(random, 3, 0, 2))
				.setF(3, values(random, 3, 0, 2))
				.setF(4, dfgLut(between(random, 0, 1), between(random, 0, 1)));
		}),
		expected: (i) => {
			const m = materialOf(i);
			const dfg = xy(i.f(4));
			const [dielectricSingle, dielectricMulti] = multiscattering(m.specular, m.grazing, dfg);
			const [metallicSingle, metallicMulti] = multiscattering(m.base, m.grazing, dfg);
			const single = mix3(dielectricSingle, metallicSingle, m.metalness);
			const multi = mix3(dielectricMulti, metallicMulti, m.metalness);
			const cosineWeighted = scale(xyz(i.f(3)), INV_PI);
			const diffuse = mul(m.diffuse, sub([1, 1, 1], add(dielectricSingle, dielectricMulti)));
			return floats(
				mul(diffuse, cosineWeighted),
				add(mul(xyz(i.f(2)), single), mul(multi, cosineWeighted)),
			);
		},
	},
	// null3d::fog
	{
		name: 'fog::fog_exponential',
		cases: samples((random) =>
			new Inputs().setF(0, [between(random, 0, 300), between(random, 0, 0.05)]),
		),
		expected: (i) => {
			const [distance, density] = i.f(0);
			return scalar(1 - Math.exp(-density * distance));
		},
	},
	{
		name: 'fog::fog_linear',
		cases: samples((random) => new Inputs().setF(0, [between(random, 0, 120), 10, 100])),
		expected: (i) => {
			const [depth, near, far] = i.f(0);
			return scalar(smooth(near, far, depth));
		},
	},
	{
		name: 'fog::fog_exp2',
		cases: samples((random) =>
			new Inputs().setF(0, [between(random, 0, 100), between(random, 0, 0.05)]),
		),
		expected: (i) => {
			const [depth, density] = i.f(0);
			return scalar(1 - Math.exp(-density * density * depth * depth));
		},
	},
	{
		name: 'fog::apply_fog',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, 0, 1))
				.setF(1, values(random, 3, 0, 1))
				.setF(2, [between(random, 0, 1)]),
		),
		expected: (i) => floats(mix3(xyz(i.f(0)), xyz(i.f(1)), i.f(2)[0])),
	},
	// null3d::vertex
	{
		name: 'vertex::transform_point',
		cases: transformCase,
		expected: (i) => floats(transformPoint(rows(i), xyz(i.f(3)))),
	},
	{
		name: 'vertex::transform_direction',
		cases: transformCase,
		expected: (i) => floats(map3([0, 1, 2] as V3, (k) => dot(rows(i)[k]!, [...xyz(i.f(3)), 0]))),
	},
	{
		name: 'vertex::transform_normal',
		cases: transformCase,
		expected: (i) => {
			// The inverse transpose of the 3 x 3 part, solved directly: n' = inverse(M)^T n.
			const [a, b, c] = rows(i).map(xyz) as [V3, V3, V3];
			const det = dot(a, cross(b, c));
			const n = xyz(i.f(3));
			const inverseTranspose: V3[] = [cross(b, c), cross(c, a), cross(a, b)].map((r) =>
				scale(r, 1 / det),
			);
			return floats(normalize(map3([0, 1, 2] as V3, (k) => dot(inverseTranspose[k]!, n))));
		},
	},
	{
		name: 'vertex::move_transform',
		cases: transformCase,
		expected: (i) => {
			const offset = xyz(i.f(3));
			return floats(...rows(i).map((row, k) => [row[0], row[1], row[2], row[3] + offset[k]!]));
		},
	},
	{
		name: 'vertex::to_clip',
		cases: samples((random) => {
			const i = new Inputs();
			for (let k = 0; k < 4; k++) i.setF(k, values(random, 4, -2, 2));
			return i.setF(4, values(random, 3, -10, 10));
		}),
		expected: (i) => {
			const p = [...xyz(i.f(4)), 1];
			const columns = [0, 1, 2, 3].map((k) => i.f(k));
			return floats(
				[0, 1, 2, 3].map((row) =>
					columns.reduce((sum, column, k) => sum + column[row]! * p[k]!, 0),
				),
			);
		},
	},
	{
		name: 'vertex::OUTSIDE_CLIP',
		cases: () => [new Inputs()],
		expected: () => floats([2, 2, 2, 1]),
		tolerance: 0,
	},
	// null3d::depth
	{
		name: 'depth::perspective_depth_to_view_z',
		cases: samples((random) => new Inputs().setF(0, [between(random, 0, 1), 0.1, 1000])),
		expected: (i) => {
			const [depth, near, far] = i.f(0);
			return scalar((-near * far) / (near + depth * (far - near)));
		},
	},
	{
		name: 'depth::view_z_to_perspective_depth',
		cases: samples((random) => new Inputs().setF(0, [between(random, -1000, -0.1), 0.1, 1000])),
		expected: (i) => {
			const [viewZ, near, far] = i.f(0);
			return scalar((near * (viewZ + far)) / (-viewZ * (far - near)));
		},
	},
	{
		name: 'depth::orthographic_depth_to_view_z',
		cases: samples((random) => new Inputs().setF(0, [between(random, 0, 1), 1, 50])),
		expected: (i) => {
			const [depth, near, far] = i.f(0);
			return scalar(depth * (far - near) - far);
		},
	},
	{
		name: 'depth::view_z_to_orthographic_depth',
		cases: samples((random) => new Inputs().setF(0, [between(random, -50, -1), 1, 50])),
		expected: (i) => {
			const [viewZ, near, far] = i.f(0);
			return scalar((viewZ + far) / (far - near));
		},
	},
	{
		name: 'depth::linear_depth',
		cases: samples((random) => new Inputs().setF(0, [between(random, 0, 1), 0.1, 1000])),
		expected: (i) => {
			const [depth, near, far] = i.f(0);
			return scalar((near * far) / (near + depth * (far - near)));
		},
	},
	{
		name: 'depth::view_position',
		cases: samples((random) => {
			// The inverse of the engine's reversed perspective projection, with a 60-degree view.
			const f = 1 / Math.tan(Math.PI / 6);
			const [aspect, near, far] = [1.5, 0.1, 100];
			const i = new Inputs()
				.setF(0, [between(random, 0, 1), between(random, 0, 1), between(random, 0.01, 1)])
				.setF(1, [aspect / f, 0, 0, 0])
				.setF(2, [0, 1 / f, 0, 0])
				.setF(3, [0, 0, 0, (far - near) / (near * far)])
				.setF(4, [0, 0, -1, 1 / far]);
			return i;
		}),
		expected: (i) => {
			const [u, v, depth] = i.f(0);
			const clip = [u * 2 - 1, 1 - v * 2, depth, 1];
			const columns = [1, 2, 3, 4].map((k) => i.f(k));
			const p = [0, 1, 2, 3].map((row) =>
				columns.reduce((sum, column, k) => sum + column[row]! * clip[k]!, 0),
			);
			return floats([p[0]! / p[3]!, p[1]! / p[3]!, p[2]! / p[3]!]);
		},
	},
	// null3d::sdf
	{
		name: 'sdf::sphere',
		cases: samples((random) =>
			new Inputs().setF(0, [...values(random, 3, -2, 2), between(random, 0.5, 1.5)]),
		),
		expected: (i) => scalar(length(xyz(i.f(0))) - i.f(0)[3]),
	},
	{
		name: 'sdf::box',
		cases: samples((random) =>
			new Inputs().setF(0, values(random, 3, -2, 2)).setF(1, values(random, 3, 0.2, 1.5)),
		),
		expected: (i) => scalar(box(xyz(i.f(0)), xyz(i.f(1)))),
	},
	{
		name: 'sdf::round_box',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, -2, 2))
				.setF(1, [...values(random, 3, 0.4, 1.5), between(random, 0, 0.3)]),
		),
		expected: (i) => {
			const radius = i.f(1)[3];
			return scalar(
				box(
					xyz(i.f(0)),
					map3(xyz(i.f(1)), (h) => h - radius),
				) - radius,
			);
		},
	},
	{
		name: 'sdf::torus',
		cases: samples((random) =>
			new Inputs().setF(0, values(random, 3, -2, 2)).setF(1, [1, between(random, 0.1, 0.5)]),
		),
		expected: (i) => {
			const [x, y, z] = xyz(i.f(0));
			const [major, minor] = i.f(1);
			return scalar(length([length([x, z]) - major, y]) - minor);
		},
	},
	{
		name: 'sdf::capsule',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, -2, 2))
				.setF(1, values(random, 3, -1, 1))
				.setF(2, [...values(random, 3, -1, 1), between(random, 0.1, 0.5)]),
		),
		expected: (i) => {
			const pa = sub(xyz(i.f(0)), xyz(i.f(1)));
			const ba = sub(xyz(i.f(2)), xyz(i.f(1)));
			const h = saturate(dot(pa, ba) / dot(ba, ba));
			return scalar(length(sub(pa, scale(ba, h))) - i.f(2)[3]);
		},
	},
	{
		name: 'sdf::cylinder',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, -2, 2))
				.setF(1, [between(random, 0.3, 1), between(random, 0.3, 1)]),
		),
		expected: (i) => {
			const [x, y, z] = xyz(i.f(0));
			const [halfHeight, radius] = i.f(1);
			const d = [Math.abs(length([x, z])) - radius, Math.abs(y) - halfHeight];
			return scalar(Math.min(Math.max(d[0]!, d[1]!), 0) + length(d.map((k) => Math.max(k, 0))));
		},
	},
	{
		name: 'sdf::plane',
		cases: samples((random) =>
			new Inputs()
				.setF(0, values(random, 3, -2, 2))
				.setF(1, [...unit(random), between(random, -1, 1)]),
		),
		expected: (i) => scalar(dot(xyz(i.f(0)), xyz(i.f(1))) - i.f(1)[3]),
	},
	{
		name: 'sdf::circle',
		cases: samples((random) =>
			new Inputs().setF(0, [...values(random, 2, -2, 2), between(random, 0.5, 1.5)]),
		),
		expected: (i) => scalar(length(xy(i.f(0))) - i.f(0)[2]),
	},
	{
		name: 'sdf::rect',
		cases: samples((random) =>
			new Inputs().setF(0, [...values(random, 2, -2, 2), ...values(random, 2, 0.2, 1.5)]),
		),
		expected: (i) => {
			const [x, y, hx, hy] = i.f(0);
			const d = [Math.abs(x) - hx, Math.abs(y) - hy];
			return scalar(length(d.map((k) => Math.max(k, 0))) + Math.min(Math.max(d[0]!, d[1]!), 0));
		},
	},
	{
		name: 'sdf::segment',
		cases: samples((random) =>
			new Inputs().setF(0, values(random, 4, -2, 2)).setF(1, values(random, 2, -2, 2)),
		),
		expected: (i) => {
			const [px, py, ax, ay] = i.f(0);
			const [bx, by] = i.f(1);
			const pa: V3 = [px - ax, py - ay, 0];
			const ba: V3 = [bx - ax, by - ay, 0];
			const h = saturate(dot(pa, ba) / dot(ba, ba));
			return scalar(length(sub(pa, scale(ba, h))));
		},
	},
	{
		name: 'sdf::merge',
		cases: uniform(2, -2, 2),
		expected: (i) => scalar(Math.min(i.f(0)[0], i.f(0)[1])),
	},
	{
		name: 'sdf::subtract',
		cases: uniform(2, -2, 2),
		expected: (i) => scalar(Math.max(i.f(0)[0], -i.f(0)[1])),
	},
	{
		name: 'sdf::intersect',
		cases: uniform(2, -2, 2),
		expected: (i) => scalar(Math.max(i.f(0)[0], i.f(0)[1])),
	},
	{
		name: 'sdf::smooth_merge',
		cases: uniform(3, 0.05, 1),
		expected: (i) => {
			const [a, b, k] = i.f(0);
			const h = saturate(0.5 + (0.5 * (b - a)) / k);
			return scalar(mix(b, a, h) - k * h * (1 - h));
		},
	},
	{
		name: 'sdf::smooth_subtract',
		cases: uniform(3, 0.05, 1),
		expected: (i) => {
			const [a, b, k] = i.f(0);
			const h = saturate(0.5 - (0.5 * (a + b)) / k);
			return scalar(mix(a, -b, h) + k * h * (1 - h));
		},
	},
	{
		name: 'sdf::smooth_intersect',
		cases: uniform(3, 0.05, 1),
		expected: (i) => {
			const [a, b, k] = i.f(0);
			const h = saturate(0.5 - (0.5 * (b - a)) / k);
			return scalar(mix(b, a, h) + k * h * (1 - h));
		},
	},
	{
		name: 'sdf::rounded',
		cases: uniform(2, -2, 2),
		expected: (i) => scalar(i.f(0)[0] - i.f(0)[1]),
	},
	{
		name: 'sdf::onion',
		cases: uniform(2, -2, 2),
		expected: (i) => scalar(Math.abs(i.f(0)[0]) - i.f(0)[1]),
	},
	// null3d::fog's scene fog, numbered after the other modules' functions. Each curve, by the
	// engine's codes, at points around the camera, in fog that thins with height and in fog that
	// does not.
	{
		name: 'fog::fog_factor',
		cases: (random) =>
			[FOG_CURVE_NONE, FOG_CURVE_LINEAR, FOG_CURVE_EXP2, FOG_CURVE_EXPONENTIAL].flatMap((curve) =>
				[0, 0.05].flatMap((falloff) => sceneFogCases(curve, falloff)(random)),
			),
		expected: (i) => scalar(fogFactor(i)),
	},
	// null3d::vertex, the attribute readers. The test page sets no pipeline constants, so each
	// scale keeps its default of 1, as on WebGL2 and for float attributes on WebGPU.
	{
		name: 'vertex::mesh_position',
		cases: samples((random) => new Inputs().setF(0, values(random, 3, -100, 100))),
		expected: (i) => floats(xyz(i.f(0))),
		tolerance: 0,
	},
	{
		name: 'vertex::mesh_uv',
		cases: samples((random) => new Inputs().setF(0, values(random, 2, -2, 2))),
		expected: (i) => floats(i.f(0).slice(0, 2)),
		tolerance: 0,
	},
	{
		name: 'vertex::mesh_second_uv',
		cases: samples((random) => new Inputs().setF(0, values(random, 2, -2, 2))),
		expected: (i) => floats(i.f(0).slice(0, 2)),
		tolerance: 0,
	},
	// null3d::color, the limit of HDR color: each channel no brighter than one step below the
	// largest 16-bit float, infinity included, and every value below it kept.
	{
		name: 'color::limit_hdr',
		cases: (random) => [
			new Inputs().setF(0, [65472, 65473, 1e30]),
			new Inputs().setF(0, [Number.POSITIVE_INFINITY, 0.5, -2]),
			...uniform(3, 0, 70000)(random),
		],
		expected: (i) => floats(map3(xyz(i.f(0)), (value) => Math.min(value, 65472))),
		tolerance: 0,
	},
	// null3d::fog's functions of the native fog: its height and its sun glow.
	{
		name: 'fog::fog_height_ratio',
		cases: (random) => [
			// No rise, and rises on both sides of the series' limit.
			new Inputs().setF(0, [0]),
			new Inputs().setF(0, [0.005]),
			new Inputs().setF(0, [-0.02]),
			new Inputs().setF(0, [-1000]),
			...samples((r) => new Inputs().setF(0, [between(r, -16, 16)]))(random),
		],
		expected: (i) => scalar(heightRatio(i.f(0)[0])),
	},
	{
		name: 'fog::fog_color',
		cases: (random) =>
			[0, 0.5].flatMap((glow) =>
				samples((r) =>
					sceneFog(r, FOG_CURVE_EXPONENTIAL, 0)
						.setF(3, [glow, between(r, 1, 32)])
						.setF(5, unit(r))
						.setF(6, values(r, 3, 0, 4)),
				)(random),
			),
		expected: (i) => {
			const [glow, exponent] = i.f(3);
			const toward = Math.max(dot(normalize(xyz(i.f(4))), scale(xyz(i.f(5)), -1)), 0);
			return floats(add(xyz(i.f(0)), scale(xyz(i.f(6)), glow * toward ** exponent)));
		},
	},
];

/** The largest exponent of the fog's height terms, as `null3d::fog` limits it. */
const FOG_HEIGHT_EXPONENT_LIMIT = 40;

/**
 * Inputs of a scene fog with `curve` and `falloff`: its color and density, its curve, its shape (near,
 * far, falloff and the density share at the camera's height), and a point relative to the camera.
 */
function sceneFog(random: () => number, curve: number, falloff: number): Inputs {
	return new Inputs()
		.setF(0, [...values(random, 3, 0, 1), between(random, 0, 0.05)])
		.setU(1, [curve])
		.setF(2, [between(random, 0, 20), between(random, 30, 100), falloff, between(random, 0.2, 3)])
		.setF(4, values(random, 3, -80, 80));
}

const sceneFogCases = (curve: number, falloff: number) =>
	samples((random) => sceneFog(random, curve, falloff));

/** The mean fog density along a ray whose rise times the falloff is `x`, as a share of the density at its start. */
function heightRatio(x: number): number {
	if (x === 0) return 1;
	return (1 - Math.exp(Math.min(-x, FOG_HEIGHT_EXPONENT_LIMIT))) / x;
}

/** The path through fog at its base density that hides as much as the scene fog's inputs do. */
function fogPath(i: Inputs): number {
	const relative = xyz(i.f(4));
	const [, , falloff, share] = i.f(2);
	const distance = length(relative);
	return falloff === 0 ? distance : distance * share * heightRatio(falloff * relative[1]);
}

/** The scene fog's factor for its inputs. */
function fogFactor(i: Inputs): number {
	const curve = i.u(1)[0];
	const density = i.f(0)[3];
	const [near, far] = i.f(2);
	const path = fogPath(i);
	if (curve === FOG_CURVE_LINEAR) return smooth(near, far, path);
	if (curve === FOG_CURVE_EXP2) return 1 - Math.exp(-density * density * path * path);
	if (curve === FOG_CURVE_EXPONENTIAL) return 1 - Math.exp(-density * path);
	return 0;
}

function box(p: V3, half: V3): number {
	const q = sub(map3(p, Math.abs), half);
	return length(map3(q, (x) => Math.max(x, 0))) + Math.min(Math.max(...q), 0);
}

/** One case: the number of its function in `FUNCTIONS`, and its inputs. */
export interface Case {
	function: number;
	inputs: Inputs;
}

/** Every case of every function, from a seeded generator, so every run tests the same values. */
export function allCases(seed = 1): Case[] {
	const random = seededRandom(seed);
	return FUNCTIONS.flatMap((fn, index) =>
		fn.cases(random).map((inputs) => ({ function: index, inputs })),
	);
}

/** A result that differs from its reference. */
export interface Mismatch {
	function: string;
	/** The case's inputs as floats, texel by texel. */
	inputs: number[];
	expected: number[];
	got: number[];
}

/**
 * Compares the bits the GPU wrote for each case with the references. `bits` holds sixteen values
 * per case, in the order of `cases`.
 */
export function compareResults(cases: readonly Case[], bits: Uint32Array): Mismatch[] {
	const asFloats = new Float32Array(bits.buffer, bits.byteOffset, bits.length);
	const mismatches: Mismatch[] = [];
	cases.forEach(({ function: index, inputs }, k) => {
		const fn = FUNCTIONS[index]!;
		const { values: expected, whole: isWhole } = fn.expected(inputs);
		const at = k * RESULT_VALUES;
		const got = Array.from(
			isWhole ? bits.subarray(at, at + RESULT_VALUES) : asFloats.subarray(at, at + RESULT_VALUES),
		);
		const tolerance = fn.tolerance ?? DEFAULT_TOLERANCE;
		const wrong = expected.some((e, j) => {
			const g = got[j]!;
			if (isWhole) return g !== e >>> 0;
			if (tolerance === 0) return g !== Math.fround(e);
			return !(Math.abs(g - e) <= tolerance * Math.max(1, Math.abs(e)));
		});
		if (wrong)
			mismatches.push({
				function: fn.name,
				inputs: [...inputs.bits].map((_, j) => inputs.f(j >> 2)[j & 3]!),
				expected,
				got,
			});
	});
	return mismatches;
}
