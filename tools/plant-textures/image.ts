// Pictures for the plant texture tool: linear colour and coverage in float planes, and the filters
// the leaf and bark steps share. Every step uses only additions, multiplications, divisions, square
// roots and rounding, which give the same result in every JavaScript engine on every CPU, so the
// same sources give the same textures on every machine.
import { decodeImage, linearToSrgb, srgbToLinear } from '../../packages/cli/src/assets/images.js';

/** One channel of values, rows top first. */
export interface Plane {
	readonly width: number;
	readonly height: number;
	readonly data: Float32Array;
}

/** Linear colour from 0 to 1 and coverage from 0 to 1, rows top first. */
export interface Picture {
	readonly width: number;
	readonly height: number;
	readonly r: Float32Array;
	readonly g: Float32Array;
	readonly b: Float32Array;
	readonly a: Float32Array;
}

/** An empty plane. */
export function plane(width: number, height: number): Plane {
	return { width, height, data: new Float32Array(width * height) };
}

/** An empty picture, transparent black. */
export function picture(width: number, height: number): Picture {
	const n = width * height;
	return {
		width,
		height,
		r: new Float32Array(n),
		g: new Float32Array(n),
		b: new Float32Array(n),
		a: new Float32Array(n),
	};
}

/** The channels of a picture, colour first. */
export function channels(p: Picture): readonly Float32Array[] {
	return [p.r, p.g, p.b, p.a];
}

/** Decodes a PNG into linear colour and coverage. */
export function decodePicture(bytes: Uint8Array): Picture {
	const image = decodeImage(bytes, 'image/png');
	const out = picture(image.width, image.height);
	const { data } = image;
	for (let i = 0; i < image.width * image.height; i++) {
		out.r[i] = srgbToLinear(data[i * 4] as number) / 65535;
		out.g[i] = srgbToLinear(data[i * 4 + 1] as number) / 65535;
		out.b[i] = srgbToLinear(data[i * 4 + 2] as number) / 65535;
		out.a[i] = (data[i * 4 + 3] as number) / 255;
	}
	return out;
}

/** A value clamped to 0 to 1. */
export function unit(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The picture as 8-bit sRGB texels, with its coverage as alpha, or opaque. */
export function srgbBytes(p: Picture, alpha: boolean): Uint8Array {
	const n = p.width * p.height;
	const out = new Uint8Array(n * 4);
	for (let i = 0; i < n; i++) {
		out[i * 4] = linearToSrgb(Math.round(unit(p.r[i] as number) * 65535));
		out[i * 4 + 1] = linearToSrgb(Math.round(unit(p.g[i] as number) * 65535));
		out[i * 4 + 2] = linearToSrgb(Math.round(unit(p.b[i] as number) * 65535));
		out[i * 4 + 3] = alpha ? Math.round(unit(p.a[i] as number) * 255) : 255;
	}
	return out;
}

/** Linear luminance (Rec. 709 weights). */
export function luminance(p: Picture): Plane {
	const out = plane(p.width, p.height);
	for (let i = 0; i < out.data.length; i++)
		out.data[i] =
			0.2126 * (p.r[i] as number) + 0.7152 * (p.g[i] as number) + 0.0722 * (p.b[i] as number);
	return out;
}

/** The picture turned left for right. */
export function mirror(p: Picture): Picture {
	const out = picture(p.width, p.height);
	const from = channels(p);
	const to = channels(out);
	for (let y = 0; y < p.height; y++)
		for (let x = 0; x < p.width; x++) {
			const a = y * p.width + x;
			const b = y * p.width + (p.width - 1 - x);
			for (let c = 0; c < 4; c++)
				(to[c] as Float32Array)[b] = (from[c] as Float32Array)[a] as number;
		}
	return out;
}

/** The index of a coordinate past the edge: wrapped round, or held at the edge. */
function edge(i: number, n: number, wrap: boolean): number {
	if (wrap) return ((i % n) + n) % n;
	return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/** One pass of a box filter of `2r + 1` texels along rows, then along columns. */
function boxPass(src: Float32Array, w: number, h: number, r: number, wrap: boolean): Float32Array {
	const tmp = new Float32Array(w * h);
	const out = new Float32Array(w * h);
	const span = 2 * r + 1;
	for (let y = 0; y < h; y++) {
		const row = y * w;
		let sum = 0;
		for (let i = -r; i <= r; i++) sum += src[row + edge(i, w, wrap)] as number;
		for (let x = 0; x < w; x++) {
			tmp[row + x] = sum / span;
			sum +=
				(src[row + edge(x + r + 1, w, wrap)] as number) -
				(src[row + edge(x - r, w, wrap)] as number);
		}
	}
	for (let x = 0; x < w; x++) {
		let sum = 0;
		for (let i = -r; i <= r; i++) sum += tmp[edge(i, h, wrap) * w + x] as number;
		for (let y = 0; y < h; y++) {
			out[y * w + x] = sum / span;
			sum +=
				(tmp[edge(y + r + 1, h, wrap) * w + x] as number) -
				(tmp[edge(y - r, h, wrap) * w + x] as number);
		}
	}
	return out;
}

/**
 * A blur close to a Gaussian of about `radius` texels: three box passes, each a third of the
 * variance. `wrap` treats the plane as a tile.
 */
export function blur(p: Plane, radius: number, wrap: boolean): Plane {
	const r = Math.max(0, Math.round(radius / 1.7));
	if (r === 0) return { ...p, data: Float32Array.from(p.data) };
	let data = p.data;
	for (let pass = 0; pass < 3; pass++) data = boxPass(data, p.width, p.height, r, wrap);
	return { width: p.width, height: p.height, data };
}

/** A blur of values where each texel counts by its weight: blur(v·w) / blur(w). */
export function blurWeighted(values: Plane, weights: Plane, radius: number, wrap: boolean): Plane {
	const product = plane(values.width, values.height);
	for (let i = 0; i < product.data.length; i++)
		product.data[i] = (values.data[i] as number) * (weights.data[i] as number);
	const top = blur(product, radius, wrap);
	const bottom = blur(weights, radius, wrap);
	const out = plane(values.width, values.height);
	for (let i = 0; i < out.data.length; i++) {
		const w = bottom.data[i] as number;
		out.data[i] = w > 1e-6 ? (top.data[i] as number) / w : 0;
	}
	return out;
}

/** Half the size by a box of 2 × 2 texels. A tile stays a tile. */
export function halvePlane(p: Plane): Plane {
	const w = p.width >> 1;
	const h = p.height >> 1;
	const out = plane(w, h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = 2 * y * p.width + 2 * x;
			out.data[y * w + x] =
				((p.data[i] as number) +
					(p.data[i + 1] as number) +
					(p.data[i + p.width] as number) +
					(p.data[i + p.width + 1] as number)) /
				4;
		}
	return out;
}

/** Half the size by a box of 2 × 2 texels, every channel. */
export function halve(p: Picture): Picture {
	const parts = channels(p).map(
		(data) => halvePlane({ width: p.width, height: p.height, data }).data,
	);
	return {
		width: p.width >> 1,
		height: p.height >> 1,
		r: parts[0] as Float32Array,
		g: parts[1] as Float32Array,
		b: parts[2] as Float32Array,
		a: parts[3] as Float32Array,
	};
}

/**
 * The share of each source texel that falls in each output texel along one axis, when `count`
 * output texels cover `length` source texels from `start`.
 */
function areaWeights(start: number, length: number, count: number) {
	const step = length / count;
	return Array.from({ length: count }, (_, i) => {
		const from = start + i * step;
		const to = from + step;
		const taps: [number, number][] = [];
		for (let s = Math.floor(from); s < to; s++) {
			const overlap = Math.min(to, s + 1) - Math.max(from, s);
			if (overlap > 0) taps.push([s, overlap / step]);
		}
		return taps;
	});
}

/**
 * A rectangle of the picture, `width` by `height` source texels from (`x`, `y`), without scaling.
 * Texels outside the picture read as transparent.
 */
export function crop(p: Picture, x: number, y: number, width: number, height: number): Picture {
	const result = picture(width, height);
	const from = channels(p);
	const to = channels(result);
	for (let row = 0; row < height; row++) {
		const source = y + row;
		if (source < 0 || source >= p.height) continue;
		for (let column = 0; column < width; column++) {
			const at = x + column;
			if (at < 0 || at >= p.width) continue;
			const index = row * width + column;
			for (let c = 0; c < 4; c++)
				(to[c] as Float32Array)[index] = (from[c] as Float32Array)[source * p.width + at] as number;
		}
	}
	return result;
}

/**
 * A square of the picture, `size` source texels a side from (`x`, `y`), resampled to `out` texels a
 * side by the area each output texel covers.
 */
export function resampleSquare(
	p: Picture,
	x: number,
	y: number,
	size: number,
	out: number,
): Picture {
	const across = areaWeights(x, size, out);
	const down = areaWeights(y, size, out);
	const result = picture(out, out);
	const from = channels(p);
	const to = channels(result);
	const rows = new Float64Array(out * p.height);
	for (let c = 0; c < 4; c++) {
		const src = from[c] as Float32Array;
		for (let sy = 0; sy < p.height; sy++)
			for (let ox = 0; ox < out; ox++) {
				let sum = 0;
				for (const [sx, w] of across[ox] as [number, number][])
					sum += (src[sy * p.width + edge(sx, p.width, false)] as number) * w;
				rows[sy * out + ox] = sum;
			}
		const dst = to[c] as Float32Array;
		for (let oy = 0; oy < out; oy++)
			for (let ox = 0; ox < out; ox++) {
				let sum = 0;
				for (const [sy, w] of down[oy] as [number, number][])
					sum += (rows[edge(sy, p.height, false) * out + ox] as number) * w;
				dst[oy * out + ox] = sum;
			}
	}
	return result;
}

/** A texel of a channel by bilinear filtering, held at the edges; coordinates in texels, centres at .5. */
export function bilinear(data: Float32Array, w: number, h: number, x: number, y: number): number {
	const fx = x - 0.5;
	const fy = y - 0.5;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const a = data[edge(y0, h, false) * w + edge(x0, w, false)] as number;
	const b = data[edge(y0, h, false) * w + edge(x0 + 1, w, false)] as number;
	const c = data[edge(y0 + 1, h, false) * w + edge(x0, w, false)] as number;
	const d = data[edge(y0 + 1, h, false) * w + edge(x0 + 1, w, false)] as number;
	return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Fills the colour of every texel that `known` leaves out from the known texels near it: rings of
 * neighbours' means first, then a pyramid's coarse means further out. A mip level that mixes a
 * cut-out's edge with the texels past it then mixes in the edge's own colour, never a halo.
 */
export function bleed(p: Picture, known: Uint8Array, rings = 8): void {
	const { width: w, height: h } = p;
	const colour = [p.r, p.g, p.b];
	const mark = Uint8Array.from(known);
	for (let ring = 0; ring < rings; ring++) {
		const next = Uint8Array.from(mark);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const i = y * w + x;
				if (mark[i]) continue;
				let n = 0;
				let r = 0;
				let g = 0;
				let b = 0;
				for (let dy = -1; dy <= 1; dy++)
					for (let dx = -1; dx <= 1; dx++) {
						const xx = x + dx;
						const yy = y + dy;
						if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
						const j = yy * w + xx;
						if (!mark[j]) continue;
						r += p.r[j] as number;
						g += p.g[j] as number;
						b += p.b[j] as number;
						n++;
					}
				if (n === 0) continue;
				p.r[i] = r / n;
				p.g[i] = g / n;
				p.b[i] = b / n;
				next[i] = 1;
			}
		mark.set(next);
	}
	// Push: weighted means down to one texel. Pull: each unknown texel takes the coarser level's
	// colour, filtered between its four nearest texels.
	const levels: { w: number; h: number; c: Float64Array[]; k: Float64Array }[] = [];
	let lw = w;
	let lh = h;
	let c = colour.map((ch) => {
		const out = new Float64Array(w * h);
		for (let i = 0; i < w * h; i++) out[i] = mark[i] ? (ch[i] as number) : 0;
		return out;
	});
	let k = new Float64Array(w * h);
	for (let i = 0; i < w * h; i++) k[i] = mark[i] ? 1 : 0;
	levels.push({ w: lw, h: lh, c, k });
	while (lw > 1 || lh > 1) {
		const nw = Math.max(1, lw >> 1);
		const nh = Math.max(1, lh >> 1);
		const nc = c.map(() => new Float64Array(nw * nh));
		const nk = new Float64Array(nw * nh);
		for (let y = 0; y < lh; y++)
			for (let x = 0; x < lw; x++) {
				const j = Math.min(nh - 1, y >> 1) * nw + Math.min(nw - 1, x >> 1);
				const i = y * lw + x;
				nk[j] = (nk[j] as number) + (k[i] as number);
				for (let ch = 0; ch < 3; ch++)
					(nc[ch] as Float64Array)[j] =
						((nc[ch] as Float64Array)[j] as number) + ((c[ch] as Float64Array)[i] as number);
			}
		levels.push({ w: nw, h: nh, c: nc, k: nk });
		lw = nw;
		lh = nh;
		c = nc;
		k = nk;
	}
	const means = levels.map((level) =>
		level.c.map((ch) => {
			const out = new Float32Array(level.w * level.h);
			for (let i = 0; i < out.length; i++) {
				const weight = level.k[i] as number;
				out[i] = weight > 0 ? (ch[i] as number) / weight : Number.NaN;
			}
			return out;
		}),
	);
	for (let l = levels.length - 2; l >= 0; l--) {
		const level = levels[l] as (typeof levels)[number];
		const coarse = levels[l + 1] as (typeof levels)[number];
		const fine = means[l] as Float32Array[];
		const from = means[l + 1] as Float32Array[];
		for (let y = 0; y < level.h; y++)
			for (let x = 0; x < level.w; x++) {
				const i = y * level.w + x;
				if (!Number.isNaN((fine[0] as Float32Array)[i] as number)) continue;
				const sx = ((x + 0.5) * coarse.w) / level.w;
				const sy = ((y + 0.5) * coarse.h) / level.h;
				for (let ch = 0; ch < 3; ch++)
					(fine[ch] as Float32Array)[i] = bilinear(
						from[ch] as Float32Array,
						coarse.w,
						coarse.h,
						sx,
						sy,
					);
			}
	}
	const top = means[0] as Float32Array[];
	for (let i = 0; i < w * h; i++) {
		if (mark[i]) continue;
		for (let ch = 0; ch < 3; ch++) {
			const v = (top[ch] as Float32Array)[i] as number;
			(colour[ch] as Float32Array)[i] = Number.isNaN(v) ? 0 : v;
		}
	}
}

/** The value below which a share `q` of the values lies. */
export function percentile(values: ArrayLike<number>, q: number): number {
	const sorted = Float64Array.from(values).sort();
	if (sorted.length === 0) return 0;
	return sorted[
		Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
	] as number;
}

/**
 * A tangent-space normal map from a height field: x right, y up the picture, z out, written as
 * bytes from 0 to 255 per component. `slopeX` and `slopeY` turn a height step between neighbours
 * across and up the picture into a slope; `wrap` treats the field as a tile.
 */
export function normalBytes(
	height: Plane,
	slopeX: number,
	slopeY: number,
	wrap: boolean,
): Uint8Array {
	const { width: w, height: h, data } = height;
	const out = new Uint8Array(w * h * 4);
	const at = (x: number, y: number) => data[edge(y, h, wrap) * w + edge(x, w, wrap)] as number;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			// Sobel: right minus left, and up the picture (rows run down) minus down.
			const dx =
				(at(x + 1, y - 1) +
					2 * at(x + 1, y) +
					at(x + 1, y + 1) -
					at(x - 1, y - 1) -
					2 * at(x - 1, y) -
					at(x - 1, y + 1)) /
				8;
			const dy =
				(at(x - 1, y - 1) +
					2 * at(x, y - 1) +
					at(x + 1, y - 1) -
					at(x - 1, y + 1) -
					2 * at(x, y + 1) -
					at(x + 1, y + 1)) /
				8;
			const nx = -dx * slopeX;
			const ny = -dy * slopeY;
			const length = Math.sqrt(nx * nx + ny * ny + 1);
			const i = (y * w + x) * 4;
			out[i] = Math.round((nx / length / 2 + 0.5) * 255);
			out[i + 1] = Math.round((ny / length / 2 + 0.5) * 255);
			out[i + 2] = Math.round((1 / length / 2 + 0.5) * 255);
			out[i + 3] = 255;
		}
	return out;
}
