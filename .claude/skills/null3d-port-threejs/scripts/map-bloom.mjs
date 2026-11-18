#!/usr/bin/env node
// Map a three.js bloom onto null3D's bloom settings.
//
// Usage:
//   node map-bloom.mjs unreal --strength 1.5 --radius 0.4 --threshold 0.85 [--canvas 1080]
//   node map-bloom.mjs node [--strength 1] [--radius 0] [--threshold 0] [--canvas 1080]
//   node map-bloom.mjs pmndrs [--intensity 1] [--luminance-threshold 1] [--luminance-smoothing 0.03]
//                             [--radius 0.85] [--levels 8] [--canvas 1080]
//   node map-bloom.mjs table
//
// `unreal`, `node` and `pmndrs` also take `--no-smooth` and `--no-trim`.
//
// `unreal` maps UnrealBloomPass, `node` maps the bloom() node and `pmndrs` maps BloomEffect from
// the postprocessing package. Each prints the `bloom` settings for `post.set()` as JSON, then a
// line on how close the glows are. `table` prints the Markdown tables of the skill's references.
// `--canvas` is the canvas's short side in device pixels. Needs Node.js 18 or newer.
//
// No setting carries over one to one, because each bloom spreads light in its own steps. The
// script draws each glow along one axis, as the response to a bright line one pixel thick. It runs
// the source's steps on a row of texels, with the same sizes, taps, weights and filtered reads as
// its shaders. It runs null3D's mip chain the same way, one response per level. Then it picks the
// levels' shares of the glow that bring the chain's light, summed outward from the line, closest
// to the source's. The shares become the weights, and the source's total light the intensity.
//
// By default the fit also keeps the shares smooth from level to level, as far as that costs half a
// percentage point of the gap or less. It then drops the widest levels whose shares are under 1%
// of the glow, so the engine draws fewer levels. `--no-smooth` and `--no-trim` turn these off.
//
// The sources draw their glow in canvas pixels, so it is narrower on a screen with more pixels.
// null3D draws it as a share of the canvas's short side. So the two match at one canvas size only.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ strength: number, radius: number, threshold: number }} UnrealBloomSettings
 * @typedef {{ intensity?: number, luminanceThreshold?: number, luminanceSmoothing?: number,
 *   radius?: number, levels?: number }} PmndrsBloomSettings
 * @typedef {{ canvas?: number, smooth?: boolean, trim?: boolean }} MappingOptions
 * @typedef {{ gap: number, half: [number, number], most: [number, number] }} GlowGap
 * @typedef {GlowGap & { smoothing: number, levels: number, trimmed: number }} GlowFit
 * @typedef {{ intensity: number, threshold: number, knee: number, blend: 'mix' | 'add' | 'screen',
 *   weights: number[], fit: GlowFit }} MappedBloom
 */

/** The canvas's short side, in device pixels, at which the glows match by default. */
export const DEFAULT_CANVAS = 1080;

/** The reference chain: its levels, and the texels of its base level on the canvas's short side. */
export const REFERENCE_LEVELS = 10;
export const REFERENCE_BASE = 512;

/** BloomEffect's defaults for the settings that change the glow. */
export const PMNDRS_DEFAULTS = {
	intensity: 1,
	luminanceThreshold: 1,
	luminanceSmoothing: 0.03,
	radius: 0.85,
	levels: 8,
};

/** UnrealBloomPass's blur kernels, its level weights before the radius moves them, and its knee. */
const UNREAL_KERNELS = [6, 10, 14, 18, 22];
const UNREAL_FACTORS = [1, 0.8, 0.6, 0.4, 0.2];
const UNREAL_KNEE = 0.01;

/**
 * The smoothing strengths that a fit tries, and the gap it may add to keep the shares smooth. The
 * strengths weigh against the mean squared error of the spread, which is near 1e-5 for a close fit,
 * so the useful ones are small.
 */
export const SMOOTHING = [0, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1];
const SMOOTHING_GAP = 0.005;
/** The share of the glow under which the fit drops the widest levels. */
const TRIM_SHARE = 0.01;

/**
 * The chain that null3D draws on a canvas: the base level's texels on the short side, the number
 * of levels, and the offset from the reference chain's levels to these. The base is a power of
 * two, at most the reference base and at most half the short side.
 * @param {number} canvas
 */
export function chainFor(canvas) {
	let base = REFERENCE_BASE;
	while (base * 2 > canvas && base > 1) base /= 2;
	const levels = Math.max(1, REFERENCE_LEVELS - Math.log2(REFERENCE_BASE / base));
	return { base, levels, offset: REFERENCE_LEVELS - levels };
}

/**
 * Each level's weight in UnrealBloomPass's composite, before the strength.
 * @param {number} radius
 */
export function unrealLevelWeights(radius) {
	return UNREAL_FACTORS.map((f) => f + (1.2 - f - f) * radius);
}

/**
 * A row of texels read with a linear filter at a place, in texels from the first texel's center.
 * @param {Float64Array} row
 * @param {number} x
 */
function sample(row, x) {
	const last = row.length - 1;
	if (last === 0) return row[0];
	const clamped = Math.min(Math.max(x, 0), last);
	const i = Math.min(Math.floor(clamped), last - 1);
	const t = clamped - i;
	return row[i] * (1 - t) + row[i + 1] * t;
}

/**
 * Draws a row of texels from a source row. Each texel reads the source at its center plus each
 * tap's offset, in units of source texels, and sums the reads by the taps' weights.
 * @param {Float64Array} source
 * @param {number} size
 * @param {readonly (readonly [number, number])[]} taps
 * @param {number} [unit]
 */
function resample(source, size, taps, unit = 1) {
	const out = new Float64Array(size);
	const ratio = source.length / size;
	for (let j = 0; j < size; j++) {
		const x = (j + 0.5) * ratio - 0.5;
		let sum = 0;
		for (const [offset, weight] of taps) sum += weight * sample(source, x + offset * unit);
		out[j] = sum;
	}
	return out;
}

/** @type {readonly (readonly [number, number])[]} */
const BILINEAR = [[0, 1]];
/** The 13-tap step down along one axis: Jimenez's weights summed over each row of taps. */
const DOWN_13 = /** @type {const} */ ([
	[-2, 0.125],
	[-1, 0.25],
	[0, 0.25],
	[1, 0.25],
	[2, 0.125],
]);
/** BloomEffect's 13-tap step down along one axis: a sixth on the rows of outer taps, a quarter on the inner. */
const PMNDRS_DOWN = /** @type {const} */ ([
	[-2, 1 / 6],
	[-1, 0.25],
	[0, 1 / 6],
	[1, 0.25],
	[2, 1 / 6],
]);
/** The 3x3 tent along one axis. */
const TENT = /** @type {const} */ ([
	[-1, 0.25],
	[0, 0.5],
	[1, 0.25],
]);

/**
 * UnrealBloomPass's Gaussian for a kernel, with its pairs of taps merged as three.js merges them.
 * @param {number} kernel
 */
function gaussianTaps(kernel) {
	const sigma = kernel / 3;
	/** @param {number} i */
	const c = (i) => (0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma;
	/** @type {[number, number][]} */
	const taps = [[0, c(0)]];
	for (let i = 1; i < kernel; i += 2) {
		const wa = c(i);
		const wb = i + 1 < kernel ? c(i + 1) : 0;
		const w = wa + wb;
		const offset = (i * wa + (i + 1) * wb) / w;
		taps.push([offset, w], [-offset, w]);
	}
	return taps;
}

/**
 * The domain: four canvas sizes, so no glow reaches its ends, with the line in the middle.
 * @param {number} canvas
 */
function lineRow(canvas) {
	const row = new Float64Array(4 * canvas);
	row[2 * canvas] = 1;
	return row;
}

/** @param {Float64Array} row */
function total(row) {
	let sum = 0;
	for (const v of row) sum += v;
	return sum;
}

/**
 * UnrealBloomPass's glow of a line one pixel thick, at the canvas's pixels: each level's response
 * alone, before its weight. The bright pass reads the scene at half size, and each level's blur
 * across, which reads the level above, halves it again.
 * @param {number} canvas
 */
export function unrealLevels(canvas) {
	const scene = lineRow(canvas);
	let size = Math.round(scene.length / 2);
	let input = resample(scene, size, BILINEAR);
	/** @type {Float64Array[]} */
	const levels = [];
	for (const kernel of UNREAL_KERNELS) {
		const taps = gaussianTaps(kernel);
		const across = taps.reduce((sum, [, w]) => sum + w, 0);
		// Along the rows the blur across is a filtered read of the level above. Across the line it
		// keeps the line, scaled by the sum of its weights.
		const read = resample(input, size, BILINEAR).map((v) => v * across);
		const blurred = resample(read, size, taps);
		levels.push(resample(blurred, scene.length, BILINEAR));
		input = blurred;
		size = Math.round(size / 2);
	}
	return levels;
}

/**
 * BloomEffect's mip blur glow of a line, at the canvas's pixels, for its levels and radius.
 * @param {number} canvas
 * @param {number} levels
 * @param {number} radius
 */
export function pmndrsGlow(canvas, levels, radius) {
	const scene = lineRow(canvas);
	/** @type {Float64Array[]} */
	const down = [];
	let previous = scene;
	for (let level = 0; level < levels; level++) {
		const size = Math.max(1, Math.round(previous.length / 2));
		previous = resample(previous, size, PMNDRS_DOWN);
		down.push(previous);
	}
	let up = down[levels - 1];
	for (let level = levels - 2; level >= 0; level--) {
		const base = down[level];
		const blurred = resample(up, base.length, TENT);
		up = base.map((v, i) => v + (blurred[i] - v) * radius);
	}
	return resample(up, scene.length, BILINEAR);
}

/**
 * null3D's glow of a line from each level of its chain alone, at the canvas's pixels: the steps
 * down to the level, the tent steps up from it to the base, then the final pass's filtered read.
 * @param {number} canvas
 * @param {{ base: number, levels: number }} [chain]
 */
export function mipLevels(canvas, chain = chainFor(canvas)) {
	const scene = lineRow(canvas);
	// The domain spans four short sides, so each level has four times its texels in it.
	/** @type {number[]} */
	const sizes = [];
	let size = chain.base;
	for (let level = 0; level < chain.levels; level++) {
		sizes.push(4 * size);
		size = Math.ceil(size / 2);
	}
	/** @type {Float64Array[]} */
	const down = [];
	let previous = scene;
	for (const target of sizes) {
		// The taps are half a target texel apart, in texels of the source.
		previous = resample(previous, target, DOWN_13, (0.5 * previous.length) / target);
		down.push(previous);
	}
	return down.map((level, k) => {
		let up = level;
		for (let j = k - 1; j >= 0; j--) up = resample(up, sizes[j], TENT);
		return resample(up, scene.length, BILINEAR);
	});
}

/**
 * A row's light summed outward from the line, on one side, as a share of its total.
 * @param {Float64Array} row
 */
function spread(row) {
	const half = row.length / 2;
	const sum = total(row);
	const out = new Float64Array(half);
	let acc = row[half];
	out[0] = acc / sum;
	for (let r = 1; r < half; r++) {
		acc += row[half + r] + row[half - r];
		out[r] = acc / sum;
	}
	return out;
}

/**
 * Projects a vector onto the weights of 0 or more that sum to 1.
 * @param {number[]} v
 */
function toSimplex(v) {
	const sorted = [...v].sort((a, b) => b - a);
	let sum = 0;
	let theta = 0;
	for (let i = 0; i < sorted.length; i++) {
		sum += sorted[i];
		const t = (sum - 1) / (i + 1);
		if (i === sorted.length - 1 || sorted[i + 1] <= t) {
			theta = t;
			break;
		}
	}
	return v.map((x) => Math.max(x - theta, 0));
}

/**
 * The shares of the glow, one per basis row, that bring the basis's spread closest to the
 * target's. It solves least squares by projected gradient steps, over the spread out to the
 * domain's middle half, with shares of 0 or more that sum to 1. A smoothing above 0 adds that
 * much of the sum of the shares' squared second differences to the mean squared error.
 * @param {Float64Array[]} basis
 * @param {Float64Array} target
 * @param {number} [smoothing]
 */
export function fitShares(basis, target, smoothing = 0) {
	const n = basis.length;
	if (n === 1) return [1];
	const columns = basis.map(spread);
	const goal = spread(target);
	const rows = goal.length;
	const ata = Array.from({ length: n }, () => new Array(n).fill(0));
	const atb = new Array(n).fill(0);
	for (let r = 0; r < rows; r++)
		for (let i = 0; i < n; i++) {
			const ai = columns[i][r] / rows;
			atb[i] += ai * goal[r];
			for (let j = 0; j < n; j++) ata[i][j] += ai * columns[j][r];
		}
	// Each second difference is a share less twice the next plus the one after it.
	for (let k = 0; k + 2 < n; k++) {
		const d = [1, -2, 1];
		for (let a = 0; a < 3; a++)
			for (let b = 0; b < 3; b++) ata[k + a][k + b] += smoothing * d[a] * d[b];
	}
	/** @param {number[]} v */
	const times = (v) => ata.map((row) => row.reduce((sum, a, j) => sum + a * v[j], 0));
	// The step is the inverse of the largest eigenvalue, found by power iteration, and the steps
	// carry momentum, so the fit converges when the levels' glows are much alike.
	let e = new Array(n).fill(1);
	let largest = 1;
	for (let iteration = 0; iteration < 200; iteration++) {
		const next = times(e);
		largest = Math.hypot(...next);
		e = next.map((v) => v / largest);
	}
	const step = 1 / largest;
	let x = toSimplex(new Array(n).fill(1 / n));
	let y = x;
	let t = 1;
	for (let iteration = 0; iteration < 20_000; iteration++) {
		const gradient = times(y).map((g, i) => g - atb[i]);
		const next = toSimplex(y.map((yi, i) => yi - step * gradient[i]));
		const tNext = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
		y = next.map((v, i) => v + ((t - 1) / tNext) * (v - x[i]));
		x = next;
		t = tNext;
	}
	return x;
}

/**
 * The sum of rows, each times its weight.
 * @param {readonly Float64Array[]} rows
 * @param {readonly number[]} weights
 */
export function weighted(rows, weights) {
	const out = new Float64Array(rows[0].length);
	rows.forEach((row, k) => {
		const w = weights[k] ?? 0;
		for (let i = 0; i < out.length; i++) out[i] += w * row[i];
	});
	return out;
}

/**
 * How far two glows differ. `gap` is the largest gap between the shares of their light within any
 * distance of the line. `half` and `most` are the distances in canvas pixels within which each
 * glow holds half and 90% of its light.
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @returns {GlowFit}
 */
export function compareGlows(a, b) {
	const sa = spread(a);
	const sb = spread(b);
	let gap = 0;
	for (let r = 0; r < sa.length; r++) gap = Math.max(gap, Math.abs(sa[r] - sb[r]));
	/** @param {Float64Array} s @param {number} share */
	const within = (s, share) => s.findIndex((v) => v >= share);
	return {
		gap,
		half: [within(sa, 0.5), within(sb, 0.5)],
		most: [within(sa, 0.9), within(sb, 0.9)],
	};
}

/** @param {number} value @param {number} places */
const round = (value, places) => Number(value.toFixed(places));

/**
 * The levels that the engine draws for some shares: those up to the last with a share.
 * @param {readonly number[]} shares
 */
const drawnLevels = (shares) => shares.findLastIndex((share) => share > 0) + 1;

/**
 * Drops the widest levels whose shares are under the trim share, and scales the rest to sum to 1.
 * @param {number[]} shares
 */
function trimWidest(shares) {
	const out = [...shares];
	for (let last = drawnLevels(out) - 1; last > 0 && out[last] < TRIM_SHARE; last--) out[last] = 0;
	const sum = out.reduce((a, b) => a + b, 0);
	return out.map((share) => round(share / sum, 4));
}

/**
 * Fits the chain to a source's glow at a canvas size. It returns the reference levels' weights,
 * the source's total light, and how close the chain's glow with those weights comes.
 * @param {Float64Array} glow
 * @param {number} canvas
 * @param {MappingOptions} options
 */
function fitGlow(glow, canvas, { smooth = true, trim = true }) {
	const chain = chainFor(canvas);
	const basis = mipLevels(canvas, chain);
	/** @param {number[]} shares */
	const gapOf = (shares) => compareGlows(weighted(basis, shares), glow).gap;
	let shares = fitShares(basis, glow);
	let smoothing = 0;
	if (smooth) {
		// The strongest smoothing whose gap stays within the allowance of the plain fit's gap.
		const limit = gapOf(shares) + SMOOTHING_GAP;
		for (const strength of SMOOTHING.slice(1)) {
			const smoothed = fitShares(basis, glow, strength);
			if (gapOf(smoothed) <= limit) [shares, smoothing] = [smoothed, strength];
		}
	}
	shares = shares.map((share) => round(share, 4));
	const untrimmed = drawnLevels(shares);
	if (trim) shares = trimWidest(shares);
	const levels = drawnLevels(shares);
	const weights = new Array(REFERENCE_LEVELS).fill(0);
	shares.forEach((share, k) => {
		weights[k + chain.offset] = share;
	});
	const fit = {
		...compareGlows(weighted(basis, shares), glow),
		smoothing,
		levels,
		trimmed: untrimmed - levels,
	};
	return { weights, light: total(glow), fit };
}

/**
 * UnrealBloomPass's glow of a line, with its level weights and without its strength.
 * @param {number} radius
 * @param {number} canvas
 */
export function unrealGlow(radius, canvas) {
	return weighted(unrealLevels(canvas), unrealLevelWeights(radius));
}

/**
 * UnrealBloomPass's settings as null3D's bloom: the threshold with the pass's narrow knee, an
 * added glow, and the weights that match its glow at the canvas size.
 * @param {UnrealBloomSettings} settings
 * @param {MappingOptions} [options]
 * @returns {MappedBloom}
 */
export function mapUnrealBloomPass(settings, options = {}) {
	return mapUnreal(settings, options, 3);
}

/**
 * The bloom() node's settings as null3D's bloom. The node runs UnrealBloomPass's steps without its
 * composite factor of 3, and a port adds the node's glow to the scene.
 * @param {UnrealBloomSettings} settings
 * @param {MappingOptions} [options]
 * @returns {MappedBloom}
 */
export function mapBloomNode(settings, options = {}) {
	return mapUnreal(settings, options, 1);
}

/**
 * @param {UnrealBloomSettings} settings
 * @param {MappingOptions} options
 * @param {number} factor
 * @returns {MappedBloom}
 */
function mapUnreal({ strength, radius, threshold }, options, factor) {
	const canvas = options.canvas ?? DEFAULT_CANVAS;
	const { weights, light, fit } = fitGlow(unrealGlow(radius, canvas), canvas, options);
	return {
		intensity: round(factor * strength * light, 4),
		threshold,
		knee: UNREAL_KNEE,
		blend: 'add',
		weights,
		fit,
	};
}

/**
 * BloomEffect's settings as null3D's bloom: its intensity, the luminance threshold and smoothing
 * as the threshold and knee, a screen blend, and the weights that match its mip blur glow at the
 * canvas size.
 * @param {PmndrsBloomSettings} [settings]
 * @param {MappingOptions} [options]
 * @returns {MappedBloom}
 */
export function mapPmndrsBloom(settings = {}, options = {}) {
	const s = { ...PMNDRS_DEFAULTS, ...settings };
	const canvas = options.canvas ?? DEFAULT_CANVAS;
	const glow = pmndrsGlow(canvas, s.levels, s.radius);
	const { weights, light, fit } = fitGlow(glow, canvas, options);
	return {
		intensity: round(s.intensity * light, 4),
		threshold: s.luminanceThreshold,
		knee: s.luminanceSmoothing,
		blend: 'screen',
		weights,
		fit,
	};
}

/**
 * One table row: the source's setting, the intensity, and the weights to 3 decimals.
 * @param {number} setting
 * @param {MappedBloom} mapped
 */
function tableRow(setting, mapped) {
	const weights = mapped.weights.map((w) => round(w, 3)).join(', ');
	return `| ${setting} | ${round(mapped.intensity, 3)} | \`[${weights}]\` |`;
}

/** The Markdown tables of mapped weights at the default canvas size, as the `table` command prints them. */
export function bloomTables() {
	const unreal = [0, 0.25, 0.5, 0.75, 1].map((radius) =>
		tableRow(radius, mapUnrealBloomPass({ strength: 1, radius, threshold: 0 })),
	);
	const pmndrs = [0.6, 0.7, 0.85, 0.95].map((radius) =>
		tableRow(radius, mapPmndrsBloom({ intensity: 1, radius, levels: 8 })),
	);
	return [
		`\`UnrealBloomPass\`, for a canvas whose short side is ${DEFAULT_CANVAS} device pixels. Set \`blend: 'add'\` and \`knee: ${UNREAL_KNEE}\`, and keep the threshold. Multiply the intensity by \`strength\`.`,
		'',
		'| `radius` | Intensity per unit of `strength` | `weights` |',
		'| --- | --- | --- |',
		...unreal,
		'',
		`pmndrs \`BloomEffect\` with \`mipmapBlur\` and 8 levels, for the same canvas. Set \`blend: 'screen'\`. The threshold is \`luminanceThreshold\` and the knee is \`luminanceSmoothing\`. Multiply the intensity by \`intensity\`.`,
		'',
		'| `radius` | Intensity per unit of `intensity` | `weights` |',
		'| --- | --- | --- |',
		...pmndrs,
		'',
	].join('\n');
}

const USAGE = `Usage:
  node map-bloom.mjs unreal --strength <n> --radius <n> --threshold <n> [--canvas 1080]
  node map-bloom.mjs node [--strength 1] [--radius 0] [--threshold 0] [--canvas 1080]
  node map-bloom.mjs pmndrs [--intensity 1] [--luminance-threshold 1] [--luminance-smoothing 0.03]
                            [--radius 0.85] [--levels 8] [--canvas 1080]
  node map-bloom.mjs table

--canvas is the canvas's short side in device pixels. unreal, node and pmndrs also take
--no-smooth, for the plain fit, and --no-trim, to keep the widest levels with little light.`;

/** @param {string} message */
function fail(message) {
	console.error(`${message}\n\n${USAGE}`);
	process.exit(2);
}

/**
 * Reads the command line's settings: each flag's number, or its fallback when the flag is absent.
 * A fallback of undefined makes the flag required.
 * @param {string[]} args
 * @param {Record<string, number | undefined>} flags
 * @returns {Record<string, number>}
 */
function readFlags(args, flags) {
	/** @type {Record<string, number>} */
	const out = {};
	for (let i = 0; i < args.length; i += 2) {
		const name = args[i].replace(/^--/, '');
		if (!args[i].startsWith('--') || !(name in flags)) fail(`Unknown option: ${args[i]}`);
		const value = Number(args[i + 1]);
		if (args[i + 1] === undefined || !Number.isFinite(value) || value < 0)
			fail(`${args[i]} needs a number of 0 or more.`);
		out[name] = value;
	}
	for (const [name, fallback] of Object.entries(flags)) {
		if (name in out) continue;
		if (fallback === undefined) fail(`--${name} is required.`);
		out[name] = /** @type {number} */ (fallback);
	}
	if (!Number.isInteger(out.canvas) || out.canvas < 1)
		fail('--canvas needs a whole number of 1 or more.');
	return out;
}

/** The fit's gap from which the command warns that the match is loose. */
const LOOSE_FIT = 0.03;

/** @param {MappedBloom} mapped */
function print({ fit, ...bloom }) {
	console.log(JSON.stringify({ bloom }, null, 2));
	console.log(
		`Fit: the shares of light within any distance of a bright line differ by at most ${(fit.gap * 100).toFixed(1)}%. ` +
			`Half the light is within ${fit.half[0]} pixels (source ${fit.half[1]}), and 90% within ${fit.most[0]} (source ${fit.most[1]}).`,
	);
	console.log(
		`The engine draws ${fit.levels} levels at this canvas size. Trimming saved ${fit.trimmed}.`,
	);
	if (fit.gap >= LOOSE_FIT)
		console.log('The match is loose at this canvas size. Compare the two glows by eye.');
}

const SWITCHES = ['--no-smooth', '--no-trim'];

/** @param {string[]} argv */
function main([command, ...argv]) {
	const args = argv.filter((arg) => !SWITCHES.includes(arg));
	const fitting = { smooth: !argv.includes('--no-smooth'), trim: !argv.includes('--no-trim') };
	if (command === 'table') {
		process.stdout.write(bloomTables());
		return;
	}
	if (command === 'unreal' || command === 'node') {
		// UnrealBloomPass needs all three settings. The node falls back to its own defaults.
		const node = command === 'node';
		const f = readFlags(args, {
			strength: node ? 1 : undefined,
			radius: node ? 0 : undefined,
			threshold: node ? 0 : undefined,
			canvas: DEFAULT_CANVAS,
		});
		const map = command === 'unreal' ? mapUnrealBloomPass : mapBloomNode;
		print(map(/** @type {UnrealBloomSettings} */ (f), { canvas: f.canvas, ...fitting }));
		return;
	}
	if (command === 'pmndrs') {
		const f = readFlags(args, {
			intensity: PMNDRS_DEFAULTS.intensity,
			'luminance-threshold': PMNDRS_DEFAULTS.luminanceThreshold,
			'luminance-smoothing': PMNDRS_DEFAULTS.luminanceSmoothing,
			radius: PMNDRS_DEFAULTS.radius,
			levels: PMNDRS_DEFAULTS.levels,
			canvas: DEFAULT_CANVAS,
		});
		if (!Number.isInteger(f.levels) || f.levels < 1)
			fail('--levels needs a whole number of 1 or more.');
		print(
			mapPmndrsBloom(
				{
					intensity: f.intensity,
					luminanceThreshold: f['luminance-threshold'],
					luminanceSmoothing: f['luminance-smoothing'],
					radius: f.radius,
					levels: f.levels,
				},
				{ canvas: f.canvas, ...fitting },
			),
		);
		return;
	}
	fail(command ? `Unknown command: ${command}` : 'Name a command.');
}

const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url)))
	main(process.argv.slice(2));
