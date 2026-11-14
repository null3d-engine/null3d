// The bark textures (slots 26 and 27, and 28 for young bark): a square of the picture, its shading
// divided out, made to tile by cutting each seam along the path where the two sides differ least
// and blending across it, then a height field from its luminance at several scales and a normal
// map from that height. Only the height's mapping from luminance is stored: the shader reads height
// from the colour.
//
// A layer may give a tint, which scales its baked colour channel by channel. The height field,
// the relief and the seams read the picture before the tint, so a tint moves the colour alone.
import type { BarkLayerConfig } from './config.ts';
import {
	blur,
	halve,
	halvePlane,
	luminance,
	normalBytes,
	type Picture,
	type Plane,
	percentile,
	picture,
	plane,
	resampleSquare,
	srgbBytes,
	unit,
} from './image.ts';
import { round } from './leaf.ts';

/** Texels a side of the overlap that each seam is cut in, as a share of the tile. */
const OVERLAP = 1 / 8;

/** Texels each side of a seam over which its two sides blend, at a tile of 1024. */
const FEATHER = 4;

/**
 * Divides out the low-frequency shading of each colour channel, then restores each channel's mean.
 * A round stem's sheen and a band of moss down a picture are broad changes of colour as well as of
 * brightness, and either one repeats as stripes once the tile wraps a branch.
 */
function delight(p: Picture, radius: number, strength: number, wrap: boolean): void {
	for (const channel of [p.r, p.g, p.b]) {
		const values: Plane = { width: p.width, height: p.height, data: channel };
		const low = blur(values, radius, wrap);
		let before = 0;
		for (const v of channel) before += v;
		before /= channel.length;
		for (let i = 0; i < channel.length; i++) {
			const l = low.data[i] as number;
			let gain = l > 1e-6 ? before / l : 1;
			gain = gain < 0.5 ? 0.5 : gain > 2 ? 2 : gain;
			channel[i] = (channel[i] as number) * (1 + strength * (gain - 1));
		}
		let after = 0;
		for (const v of channel) after += v;
		after /= channel.length;
		const restore = after > 0 ? before / after : 1;
		for (let i = 0; i < channel.length; i++) channel[i] = unit((channel[i] as number) * restore);
	}
}

/** The picture with rows and columns swapped. */
function transpose(p: Picture): Picture {
	const out = picture(p.height, p.width);
	const from = [p.r, p.g, p.b, p.a];
	const to = [out.r, out.g, out.b, out.a];
	for (let y = 0; y < p.height; y++)
		for (let x = 0; x < p.width; x++)
			for (let c = 0; c < 4; c++)
				(to[c] as Float32Array)[x * p.height + y] = (from[c] as Float32Array)[
					y * p.width + x
				] as number;
	return out;
}

/**
 * Makes a picture of `n + m` columns wrap across `n` columns: the first `m` columns are cut between
 * the picture's own and the columns past `n`, which continue the last column, along the path down
 * the rows where the two differ least. `periodic` makes the path end where it starts, for rows that
 * already wrap.
 */
function wrapColumns(p: Picture, n: number, periodic: boolean): { out: Picture; path: Int32Array } {
	const m = p.width - n;
	const h = p.height;
	const feather = Math.max(1, Math.round((FEATHER * n) / 1024));
	const from = feather;
	const to = m - feather - 1;
	const error = new Float64Array(m * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < m; x++) {
			const a = y * p.width + x;
			const b = a + n;
			const dr = (p.r[a] as number) - (p.r[b] as number);
			const dg = (p.g[a] as number) - (p.g[b] as number);
			const db = (p.b[a] as number) - (p.b[b] as number);
			error[y * m + x] = dr * dr + dg * dg + db * db;
		}
	const solve = (start: number) => {
		const cost = new Float64Array(m * h).fill(Number.POSITIVE_INFINITY);
		const back = new Int8Array(m * h);
		for (let x = from; x <= to; x++) if (start < 0 || x === start) cost[x] = error[x] as number;
		for (let y = 1; y < h; y++)
			for (let x = from; x <= to; x++) {
				let best = Number.POSITIVE_INFINITY;
				let move = 0;
				for (let d = -1; d <= 1; d++) {
					const px = x + d;
					if (px < from || px > to) continue;
					const c = cost[(y - 1) * m + px] as number;
					if (c < best) {
						best = c;
						move = d;
					}
				}
				cost[y * m + x] = best + (error[y * m + x] as number);
				back[y * m + x] = move;
			}
		let end = -1;
		let best = Number.POSITIVE_INFINITY;
		for (let x = from; x <= to; x++) {
			if (start >= 0 && Math.abs(x - start) > 1) continue;
			const c = cost[(h - 1) * m + x] as number;
			if (c < best) {
				best = c;
				end = x;
			}
		}
		const path = new Int32Array(h);
		let x = end;
		for (let y = h - 1; y >= 0; y--) {
			path[y] = x;
			x += back[y * m + x] as number;
		}
		return path;
	};
	let path = solve(-1);
	if (periodic) path = solve(path[0] as number);
	const out = picture(n, h);
	const src = [p.r, p.g, p.b, p.a];
	const dst = [out.r, out.g, out.b, out.a];
	for (let y = 0; y < h; y++) {
		const cut = path[y] as number;
		for (let x = 0; x < n; x++) {
			const a = y * p.width + x;
			// Left of the cut, the continuation of the last column; right of it, the picture's own.
			const w = x >= m ? 1 : unit((x - cut + feather) / (2 * feather));
			for (let c = 0; c < 4; c++) {
				const own = (src[c] as Float32Array)[a] as number;
				const next = x < m ? ((src[c] as Float32Array)[a + n] as number) : own;
				(dst[c] as Float32Array)[y * n + x] = next * (1 - w) + own * w;
			}
		}
	}
	return { out, path };
}

/** A square picture of `n + m` texels a side made into a tile of `n`, across and then down. */
export function makeTile(p: Picture, n: number): Picture {
	const across = wrapColumns(p, n, false).out;
	return transpose(wrapColumns(transpose(across), n, true).out);
}

/**
 * How visible a tile's seams are: the mean colour step across the edges where it wraps, over the
 * mean step between neighbouring texels inside it. Near 1, the seam reads as any other column.
 */
export function seamRatio(tile: Picture): { across: number; down: number } {
	const { width: w, height: h } = tile;
	const step = (a: number, b: number) =>
		Math.abs((tile.r[a] as number) - (tile.r[b] as number)) +
		Math.abs((tile.g[a] as number) - (tile.g[b] as number)) +
		Math.abs((tile.b[a] as number) - (tile.b[b] as number));
	let seamX = 0;
	let insideX = 0;
	for (let y = 0; y < h; y++) {
		seamX += step(y * w + w - 1, y * w);
		for (let x = 0; x < w - 1; x++) insideX += step(y * w + x, y * w + x + 1);
	}
	let seamY = 0;
	let insideY = 0;
	for (let x = 0; x < w; x++) {
		seamY += step((h - 1) * w + x, x);
		for (let y = 0; y < h - 1; y++) insideY += step(y * w + x, (y + 1) * w + x);
	}
	return {
		across: round(seamX / h / (insideX / (h * (w - 1))), 3),
		down: round(seamY / w / (insideY / (w * (h - 1))), 3),
	};
}

/** The band-pass weights of the height field, finest first: larger structures sit deeper. */
const HEIGHT_BANDS: readonly (readonly [number, number, number])[] = [
	[0, 1, 0.25],
	[1, 2, 0.4],
	[2, 4, 0.6],
	[4, 8, 0.8],
	[8, 16, 1],
	[16, 32, 1],
	[32, 64, 0.8],
];

/**
 * The tile's height in metres: luminance at several scales, furrows dark, spread so that the
 * 2nd to the 98th percentile spans `depth`, with its mean at zero. A blur of `smooth` texels at a
 * tile of 1024 first drops the photographs' fine cracks while the plates stay.
 */
function heightField(tile: Picture, depth: number, smooth: number): Plane {
	const scale = tile.width / 1024;
	const raw = luminance(tile);
	const y = smooth > 0 ? blur(raw, smooth * scale, true) : raw;
	let mean = 0;
	for (const v of y.data) mean += v;
	mean /= y.data.length;
	const blurred = new Map<number, Plane>();
	const at = (radius: number) => {
		let p = blurred.get(radius);
		if (!p) {
			p = radius === 0 ? y : blur(y, radius * scale, true);
			blurred.set(radius, p);
		}
		return p;
	};
	const out = plane(tile.width, tile.height);
	for (const [fine, coarse, weight] of HEIGHT_BANDS) {
		const a = at(fine).data;
		const b = at(coarse).data;
		for (let i = 0; i < out.data.length; i++)
			out.data[i] =
				(out.data[i] as number) + (weight * ((a[i] as number) - (b[i] as number))) / mean;
	}
	const spread = percentile(out.data, 0.98) - percentile(out.data, 0.02);
	let centre = 0;
	for (const v of out.data) centre += v;
	centre /= out.data.length;
	const k = spread > 0 ? depth / spread : 0;
	for (let i = 0; i < out.data.length; i++) out.data[i] = ((out.data[i] as number) - centre) * k;
	return out;
}

/** The least-squares map from luminance to height: height = (luminance − offset) × depth. */
function heightMapping(tile: Picture, height: Plane): { offset: number; depth: number } {
	const y = luminance(tile).data;
	const n = y.length;
	let my = 0;
	let mh = 0;
	for (let i = 0; i < n; i++) {
		my += y[i] as number;
		mh += height.data[i] as number;
	}
	my /= n;
	mh /= n;
	let cov = 0;
	let variance = 0;
	for (let i = 0; i < n; i++) {
		const dy = (y[i] as number) - my;
		cov += dy * ((height.data[i] as number) - mh);
		variance += dy * dy;
	}
	const depth = variance > 0 ? cov / variance : 0;
	return { offset: round(my - (depth !== 0 ? mh / depth : 0)), depth: round(depth, 6) };
}

/**
 * Multiplies a picture's colour by a tint, channel by channel, in linear colour. Coverage is left
 * as it is: a bark tile is opaque.
 */
function tintPicture(p: Picture, tint: readonly [number, number, number]): void {
	for (let i = 0; i < p.r.length; i++) {
		p.r[i] = unit((p.r[i] as number) * tint[0]);
		p.g[i] = unit((p.g[i] as number) * tint[1]);
		p.b[i] = unit((p.b[i] as number) * tint[2]);
	}
}

/** One bark layer's textures at both sizes, and what the manifest records of it. */
export interface BarkLayer {
	readonly full: { readonly colour: Uint8Array; readonly normal: Uint8Array };
	readonly half: { readonly colour: Uint8Array; readonly normal: Uint8Array };
	readonly mean: readonly [number, number, number];
	readonly height: { readonly offset: number; readonly depth: number };
	readonly seams: { readonly across: number; readonly down: number };
	/** The finished tile, for the review sheet. */
	readonly tile: Picture;
}

/** Makes one bark layer of `size` texels a side from its source picture. */
export function barkLayer(source: Picture, config: BarkLayerConfig, size: number): BarkLayer {
	const extra = Math.round(size * OVERLAP);
	const side = Math.min(source.width, source.height);
	const crop =
		config.crop ??
		(() => {
			const margin = Math.round(side / 32);
			return [margin, margin, side - 2 * margin] as const;
		})();
	const square = resampleSquare(source, crop[0], crop[1], crop[2], size + extra);
	delight(square, config.delight.radius * size, config.delight.strength, false);
	const tile = makeTile(square, size);
	tile.a.fill(1);
	// Everything but the colour reads the picture before the tint, so a tint cannot move the
	// relief, the seams or the height's mapping from luminance.
	const height = heightField(tile, config.depth, config.smooth);
	const mapping = heightMapping(tile, height);
	const seams = seamRatio(tile);
	if (config.tint) tintPicture(tile, config.tint);
	const texel = [config.tile[0] / size, config.tile[1] / size];
	const strength = config.normal;
	const half = halve(tile);
	const halfHeight = halvePlane(height);
	let r = 0;
	let g = 0;
	let b = 0;
	for (let i = 0; i < tile.r.length; i++) {
		r += tile.r[i] as number;
		g += tile.g[i] as number;
		b += tile.b[i] as number;
	}
	const n = tile.r.length;
	return {
		full: {
			colour: srgbBytes(tile, false),
			normal: normalBytes(
				height,
				strength / (texel[0] as number),
				strength / (texel[1] as number),
				true,
			),
		},
		half: {
			colour: srgbBytes(half, false),
			normal: normalBytes(
				halfHeight,
				strength / (2 * (texel[0] as number)),
				strength / (2 * (texel[1] as number)),
				true,
			),
		},
		mean: [round(r / n), round(g / n), round(b / n)],
		height: mapping,
		seams,
		tile,
	};
}
