// Prototype P2: maps the bloom settings of three.js's UnrealBloomPass, three.js's bloom() node and
// pmndrs's BloomEffect onto the mip-chain bloom, the default that D-53 ruling 1 names.
//
// Each source spreads light in its own steps, so no setting carries over one to one. The mapping
// draws each source's glow along one axis, as the response to a thin bright line, by running its
// steps on a row of texels: the same sizes, taps, weights and bilinear reads as the source's
// shaders. It runs the mip chain's steps the same way, one response per level, and picks the
// levels' shares of the glow that bring the chain's light, summed out from the line, closest to
// the source's. The shares become the mixes of the chain's steps up. The source's total weight
// becomes the intensity.
//
// The sources draw their glow in pixels of the canvas, so their glow is narrower on a screen with
// more pixels. The mip chain draws it as a share of the screen. A mapping therefore takes the
// canvas height, in device pixels, at which the two should match: 1080 by default.

/** The mip chain's settings, as `post.set({ bloom })` takes them on the prototype branch. */
export interface MipBloomSettings {
	method: 'mip';
	intensity: number;
	threshold: number;
	knee: number;
	levels: number;
	baseRows: number;
	karis: boolean;
	composite: 'add' | 'mix' | 'screen';
	mixes: number[];
}

/** UnrealBloomPass's settings, and the bloom() node's. */
export interface UnrealBloomSettings {
	strength: number;
	radius: number;
	threshold: number;
}

/** pmndrs BloomEffect's settings that change the glow, with its defaults. */
export interface PmndrsBloomSettings {
	intensity?: number;
	luminanceThreshold?: number;
	luminanceSmoothing?: number;
	radius?: number;
	levels?: number;
}

export const PMNDRS_DEFAULTS: Required<PmndrsBloomSettings> = {
	intensity: 1,
	luminanceThreshold: 1,
	luminanceSmoothing: 0.03,
	radius: 0.85,
	levels: 8,
};

/** What a mapping matches and what the chain draws. */
export interface MappingOptions {
	/** The canvas height in device pixels at which the glows match. */
	canvasHeight?: number;
	/**
	 * The scene's exposure, once exposure moves into the lights (D-53 ruling 12): bloom then sees
	 * exposed color, so the threshold scales with it. Today the final pass applies the exposure,
	 * and it stays 1.
	 */
	exposure?: number;
	/** The rows of the chain's base level. */
	baseRows?: number;
	/** The chain's levels. */
	levels?: number;
	/** Whether the first step down takes the Karis average. */
	karis?: boolean;
}

const DEFAULT_HEIGHT = 1080;
export const DEFAULT_BASE_ROWS = 512;
export const MAX_LEVELS = 8;

/** UnrealBloomPass's blur kernels, its level weights before the radius moves them, and its knee. */
const UNREAL_KERNELS = [6, 10, 14, 18, 22] as const;
const UNREAL_FACTORS = [1, 0.8, 0.6, 0.4, 0.2] as const;
const UNREAL_KNEE = 0.01;

/** Each level's weight in UnrealBloomPass's composite, before the strength. */
export function unrealLevelWeights(radius: number): number[] {
	return UNREAL_FACTORS.map((f) => f + (1.2 - f - f) * radius);
}

/** A row of texels read with a linear filter at `x`, in texels from the first texel's center. */
function sample(row: Float64Array, x: number): number {
	const last = row.length - 1;
	const clamped = Math.min(Math.max(x, 0), last);
	const i = Math.min(Math.floor(clamped), last - 1);
	const t = clamped - i;
	return (row[i] as number) * (1 - t) + (row[i + 1] as number) * t;
}

/**
 * Draws a row of `size` texels from `source`: each texel reads the source at its center's place
 * plus each tap's offset, in `unit` texels of the source, with the tap's weight.
 */
function resample(
	source: Float64Array,
	size: number,
	taps: readonly (readonly [number, number])[],
	unit = 1,
): Float64Array {
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

const BILINEAR = [[0, 1]] as const;
/** The 13-tap step down along one axis: Jimenez's weights summed over each row of taps. */
const DOWN_13 = [
	[-2, 0.125],
	[-1, 0.25],
	[0, 0.25],
	[1, 0.25],
	[2, 0.125],
] as const;
/** pmndrs's 13-tap step down along one axis: 1/6 on the rows of outer taps, 1/4 on the inner. */
const PMNDRS_DOWN = [
	[-2, 1 / 6],
	[-1, 0.25],
	[0, 1 / 6],
	[1, 0.25],
	[2, 1 / 6],
] as const;
/** The 3x3 tent along one axis. */
const TENT = [
	[-1, 0.25],
	[0, 0.5],
	[1, 0.25],
] as const;

/** UnrealBloomPass's Gaussian for a kernel, with its pairs of taps merged as three.js merges them. */
function gaussianTaps(kernel: number): [number, number][] {
	const sigma = kernel / 3;
	const c = (i: number) => (0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma;
	const taps: [number, number][] = [[0, c(0)]];
	for (let i = 1; i < kernel; i += 2) {
		const wa = c(i);
		const wb = i + 1 < kernel ? c(i + 1) : 0;
		const w = wa + wb;
		const offset = (i * wa + (i + 1) * wb) / w;
		taps.push([offset, w], [-offset, w]);
	}
	return taps;
}

/** The domain: four canvas heights, so no glow reaches its ends, with the line in the middle. */
function lineRow(height: number): Float64Array {
	const row = new Float64Array(4 * height);
	row[2 * height] = 1;
	return row;
}

/** The sum of a row. */
function total(row: Float64Array): number {
	let sum = 0;
	for (const v of row) sum += v;
	return sum;
}

/**
 * UnrealBloomPass's glow of a line one pixel thick, across the canvas's rows: each level's
 * response read at the canvas's pixels, unweighted. The bright pass reads the scene at half size,
 * and each level's blur across, which reads the level above, halves it again.
 */
export function unrealLevels(height: number): Float64Array[] {
	const scene = lineRow(height);
	let size = Math.round(scene.length / 2);
	let input = resample(scene, size, BILINEAR);
	const levels: Float64Array[] = [];
	for (let level = 0; level < UNREAL_KERNELS.length; level++) {
		const taps = gaussianTaps(UNREAL_KERNELS[level] as number);
		const across = taps.reduce((sum, [, w]) => sum + w, 0);
		// The blur across reads the level above at this level's size: along the rows it is a
		// filtered read, and across the line it keeps the line, scaled by its weights' sum.
		const read = resample(input, size, BILINEAR).map((v) => v * across);
		const blurred = resample(read, size, taps);
		levels.push(resample(blurred, scene.length, BILINEAR));
		input = blurred;
		size = Math.round(size / 2);
	}
	return levels;
}

/** pmndrs's MipmapBlurPass's glow of a line, at the canvas's pixels, for its levels and radius. */
export function pmndrsGlow(height: number, levels: number, radius: number): Float64Array {
	const scene = lineRow(height);
	const down: Float64Array[] = [];
	let previous = scene;
	for (let level = 0; level < levels; level++) {
		const size = Math.max(1, Math.round(previous.length / 2));
		previous = resample(previous, size, PMNDRS_DOWN);
		down.push(previous);
	}
	let up = down[levels - 1] as Float64Array;
	for (let level = levels - 2; level >= 0; level--) {
		const base = down[level] as Float64Array;
		const blurred = resample(up, base.length, TENT);
		up = base.map((v, i) => v + ((blurred[i] as number) - v) * radius);
	}
	return resample(up, scene.length, BILINEAR);
}

/**
 * The mip chain's glow of a line from each level alone, at the canvas's pixels: the steps down to
 * the level, then the tent steps up from it to the base, then the final pass's filtered read.
 */
export function mipLevels(height: number, baseRows: number, levels: number): Float64Array[] {
	const scene = lineRow(height);
	const sizes: number[] = [];
	let size = Math.round((baseRows * scene.length) / height);
	for (let level = 0; level < levels; level++) {
		sizes.push(size);
		size = Math.max(1, Math.ceil(size / 2));
	}
	const down: Float64Array[] = [];
	let previous = scene;
	for (let level = 0; level < levels; level++) {
		const target = sizes[level] as number;
		// Taps half a pixel of the target apart: a source texel where the source has twice its size.
		previous = resample(previous, target, DOWN_13, (0.5 * previous.length) / target);
		down.push(previous);
	}
	return down.map((level, k) => {
		let up = level;
		for (let j = k - 1; j >= 0; j--) up = resample(up, sizes[j] as number, TENT);
		return resample(up, scene.length, BILINEAR);
	});
}

/** A row's light summed outward from the line, on one side, as a share of its total. */
function spread(row: Float64Array): Float64Array {
	const half = row.length / 2;
	const sum = total(row);
	const out = new Float64Array(half);
	let acc = row[half] as number;
	out[0] = acc / sum;
	for (let r = 1; r < half; r++) {
		acc += (row[half + r] as number) + (row[half - r] as number);
		out[r] = acc / sum;
	}
	return out;
}

/** Projects a vector onto the simplex: weights of 0 or more that sum to 1. */
function toSimplex(v: number[]): number[] {
	const sorted = [...v].sort((a, b) => b - a);
	let sum = 0;
	let theta = 0;
	for (let i = 0; i < sorted.length; i++) {
		sum += sorted[i] as number;
		const t = (sum - 1) / (i + 1);
		if (i === sorted.length - 1 || (sorted[i + 1] as number) <= t) {
			theta = t;
			break;
		}
	}
	return v.map((x) => Math.max(x - theta, 0));
}

/**
 * The shares of the glow, one per basis row, that bring the basis's spread closest to the
 * target's, by least squares over the spread out to the domain's middle half, the shares being 0
 * or more and summing to 1.
 */
export function fitShares(basis: Float64Array[], target: Float64Array): number[] {
	const columns = basis.map(spread);
	const goal = spread(target);
	const n = columns.length;
	const rows = goal.length;
	const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
	const atb = new Array<number>(n).fill(0);
	for (let r = 0; r < rows; r++)
		for (let i = 0; i < n; i++) {
			const ai = (columns[i] as Float64Array)[r] as number;
			atb[i] = (atb[i] as number) + ai * (goal[r] as number);
			for (let j = 0; j < n; j++)
				(ata[i] as number[])[j] =
					((ata[i] as number[])[j] as number) + ai * ((columns[j] as Float64Array)[r] as number);
		}
	let bound = 0;
	for (const row of ata) for (const v of row) bound += v * v;
	const step = 1 / Math.sqrt(bound);
	let x = toSimplex(new Array<number>(n).fill(1 / n));
	for (let iteration = 0; iteration < 20_000; iteration++) {
		const gradient = x.map((_, i) => {
			let g = -(atb[i] as number);
			for (let j = 0; j < n; j++) g += ((ata[i] as number[])[j] as number) * (x[j] as number);
			return g;
		});
		x = toSimplex(x.map((xi, i) => xi - step * (gradient[i] as number)));
	}
	return x;
}

/** The mixes of the chain's steps up that give each level its share. */
export function sharesToMixes(shares: readonly number[]): number[] {
	const mixes: number[] = [];
	let rest = 1;
	for (let level = 0; level < shares.length - 1; level++) {
		const share = shares[level] as number;
		const mix = rest > 1e-9 ? Math.min(Math.max(1 - share / rest, 0), 1) : 0;
		mixes.push(mix);
		rest *= mix;
	}
	return mixes;
}

/** The shares that the mixes give, the inverse of `sharesToMixes`. */
export function mixesToShares(mixes: readonly number[], levels: number): number[] {
	const shares: number[] = [];
	let rest = 1;
	for (let level = 0; level < levels; level++) {
		if (level === levels - 1) shares.push(rest);
		else {
			const mix = mixes[level] ?? 0;
			shares.push(rest * (1 - mix));
			rest *= mix;
		}
	}
	return shares;
}

/** The sum of rows, each times its weight. */
export function weighted(rows: readonly Float64Array[], weights: readonly number[]): Float64Array {
	const out = new Float64Array((rows[0] as Float64Array).length);
	rows.forEach((row, k) => {
		const w = weights[k] ?? 0;
		for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + w * (row[i] as number);
	});
	return out;
}

/**
 * How far two glows' spreads differ: the largest gap between the shares of their light within any
 * distance of the line, and the distances in canvas pixels within which each holds half and 90% of
 * its light.
 */
export function compareGlows(a: Float64Array, b: Float64Array) {
	const sa = spread(a);
	const sb = spread(b);
	let gap = 0;
	for (let r = 0; r < sa.length; r++)
		gap = Math.max(gap, Math.abs((sa[r] as number) - (sb[r] as number)));
	const within = (s: Float64Array, share: number) => s.findIndex((v) => v >= share);
	return {
		gap,
		half: [within(sa, 0.5), within(sb, 0.5)] as const,
		most: [within(sa, 0.9), within(sb, 0.9)] as const,
	};
}

/**
 * The base rows a mapping takes for a canvas height: half the height, from 128 to 512. The
 * sources' widest glow spans a fixed number of pixels, and eight levels from a base of more than
 * half the height cannot reach it on a small canvas.
 */
export function mappedBaseRows(height: number): number {
	return Math.min(DEFAULT_BASE_ROWS, Math.max(128, Math.round(height / 2)));
}

function chainOptions(options: MappingOptions) {
	const height = options.canvasHeight ?? DEFAULT_HEIGHT;
	return {
		height,
		exposure: options.exposure ?? 1,
		baseRows: options.baseRows ?? mappedBaseRows(height),
		levels: Math.min(Math.max(options.levels ?? MAX_LEVELS, 2), MAX_LEVELS),
		karis: options.karis ?? true,
	};
}

/** Maps a glow drawn by a source's steps onto the chain, with the source's total weight. */
function mapGlow(target: Float64Array, weight: number, options: MappingOptions) {
	const { height, baseRows, levels } = chainOptions(options);
	const basis = mipLevels(height, baseRows, levels);
	const shares = fitShares(basis, target);
	return { shares, mixes: sharesToMixes(shares), intensity: weight * total(target) };
}

/**
 * UnrealBloomPass's settings on the mip chain: an additive composite, its threshold with its
 * narrow knee, and the levels' shares that reach its glow at the canvas height.
 */
export function mapUnrealBloomPass(
	settings: UnrealBloomSettings,
	options: MappingOptions = {},
	{ composite = 3 }: { composite?: number } = {},
): MipBloomSettings {
	const o = chainOptions(options);
	const weights = unrealLevelWeights(settings.radius);
	const glow = weighted(unrealLevels(o.height), weights);
	const sum = total(glow);
	const unit = glow.map((v) => v / sum);
	const { mixes, intensity } = mapGlow(unit, composite * settings.strength * sum, options);
	return {
		method: 'mip',
		intensity,
		threshold: settings.threshold * o.exposure,
		knee: UNREAL_KNEE * o.exposure,
		levels: o.levels,
		baseRows: o.baseRows,
		karis: o.karis,
		composite: 'add',
		mixes,
	};
}

/**
 * The bloom() node's settings on the mip chain: UnrealBloomPass's steps without its factor of 3.
 * The node returns the glow alone, which a port adds to the scene, so the composite adds.
 */
export function mapBloomNode(
	settings: UnrealBloomSettings,
	options: MappingOptions = {},
): MipBloomSettings {
	return mapUnrealBloomPass(settings, options, { composite: 1 });
}

/**
 * pmndrs BloomEffect's settings on the mip chain: its intensity and SCREEN composite, its
 * luminance threshold and smoothing as the threshold and its knee, and the levels' shares that
 * reach its glow at the canvas height. BloomEffect has no Karis average; the chain keeps its own
 * setting, on by default.
 */
export function mapPmndrsBloom(
	settings: PmndrsBloomSettings = {},
	options: MappingOptions = {},
): MipBloomSettings {
	const s = { ...PMNDRS_DEFAULTS, ...settings };
	const o = chainOptions(options);
	const glow = pmndrsGlow(o.height, s.levels, s.radius);
	const sum = total(glow);
	const unit = glow.map((v) => v / sum);
	const { mixes, intensity } = mapGlow(unit, s.intensity * sum, options);
	return {
		method: 'mip',
		intensity,
		threshold: s.luminanceThreshold * o.exposure,
		knee: s.luminanceSmoothing * o.exposure,
		levels: o.levels,
		baseRows: o.baseRows,
		karis: o.karis,
		composite: 'screen',
		mixes,
	};
}

/** The mip chain's glow of a line for its settings, at the canvas height, with its intensity. */
export function mipGlow(settings: MipBloomSettings, height: number): Float64Array {
	const basis = mipLevels(height, settings.baseRows, settings.levels);
	const shares = mixesToShares(settings.mixes, settings.levels);
	return weighted(basis, shares).map((v) => v * settings.intensity);
}

/** UnrealBloomPass's glow of a line for its settings, at the canvas height, with its weights. */
export function unrealGlow(
	settings: UnrealBloomSettings,
	height: number,
	factor = 3,
): Float64Array {
	const weights = unrealLevelWeights(settings.radius).map((w) => w * factor * settings.strength);
	return weighted(unrealLevels(height), weights);
}
