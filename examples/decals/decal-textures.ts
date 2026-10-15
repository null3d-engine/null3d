// Decal images made in code: scorch marks, mud, puddles, road paint, moss and cracks for the ground,
// and bare bricks, posters, graffiti and water stains for the walls. Each comes as
// texel data for `textures.fromData`: a base color map with alpha in sRGB, a map with roughness in
// green and metalness in blue, and a normal map, each `size` texels on a side. Every pattern comes
// from the engine's seeded noise and a seeded hash, so each run makes the same images.
import { math, Noise } from '@null3d/engine';

/** The texels of one decal: base color with alpha, roughness and metalness, and normals. */
export interface DecalTexels {
	size: number;
	color: Uint8Array;
	finish: Uint8Array;
	normal: Uint8Array;
}

/** What a decal's pattern gives at a point: color, alpha, roughness, metalness and height. */
interface Sample {
	r: number;
	g: number;
	b: number;
	a: number;
	rough: number;
	metal: number;
	height: number;
}

/** A value from 0 to 1 for a lattice point and a seed. */
function hash(x: number, y: number, seed: number): number {
	let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The engine's seeded value noise of each seed, made on first use. */
const noises = new Map<number, Noise>();

/** Smooth value noise from 0 to 1, which repeats every `period` units. */
function noise(x: number, y: number, seed: number, period: number): number {
	let made = noises.get(seed);
	if (!made) {
		made = new Noise(seed);
		noises.set(seed, made);
	}
	return made.value2(x, y, period) * 0.5 + 0.5;
}

/** Fractal noise from 0 to 1: `octaves` layers of value noise, each twice as fine. */
function fbm(x: number, y: number, seed: number, octaves = 5, base = 4): number {
	let [sum, weight, total, scale] = [0, 0.5, 0, base];
	for (let k = 0; k < octaves; k++) {
		sum += noise(x * scale, y * scale, seed + k, scale) * weight;
		total += weight;
		weight *= 0.5;
		scale *= 2;
	}
	return sum / total;
}

/** A share from 0 at `low` to 1 at `high`, smoothed at both ends, with `low` above `high` too. */
function ramp(low: number, high: number, x: number): number {
	return low < high ? math.smoothstep(x, low, high) : 1 - math.smoothstep(x, high, low);
}

/** Linear color to an 8-bit sRGB value. */
function srgb(c: number): number {
	const v = Math.min(1, Math.max(0, c));
	return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}

/** The distance to the nearest and second nearest cell points of a seeded grid, for cracks. */
function cells(x: number, y: number, seed: number, count: number): [number, number] {
	const [cx, cy] = [Math.floor(x * count), Math.floor(y * count)];
	let [first, second] = [9, 9];
	for (let j = -1; j <= 1; j++)
		for (let i = -1; i <= 1; i++) {
			const [gx, gy] = [cx + i, cy + j];
			const px = (gx + hash(gx, gy, seed)) / count;
			const py = (gy + hash(gx, gy, seed + 7)) / count;
			const d = Math.hypot(x - px, y - py) * count;
			if (d < first) [first, second] = [d, first];
			else if (d < second) second = d;
		}
	return [first, second];
}

/** Fills a decal's three maps from its pattern, with normals from the pattern's height. */
function texels(
	size: number,
	bumps: number,
	pattern: (x: number, y: number) => Sample,
): DecalTexels {
	const out = {
		size,
		color: new Uint8Array(size * size * 4),
		finish: new Uint8Array(size * size * 4),
		normal: new Uint8Array(size * size * 4),
	};
	const heights = new Float32Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const s = pattern((x + 0.5) / size, (y + 0.5) / size);
			const k = (y * size + x) * 4;
			out.color.set([srgb(s.r), srgb(s.g), srgb(s.b), Math.round(255 * s.a)], k);
			out.finish.set([255, Math.round(255 * s.rough), Math.round(255 * s.metal), 255], k);
			heights[y * size + x] = s.height;
		}
	const h = (x: number, y: number) =>
		heights[((y + size) % size) * size + ((x + size) % size)] ?? 0;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const dx = (h(x + 1, y) - h(x - 1, y)) * bumps;
			const dy = (h(x, y + 1) - h(x, y - 1)) * bumps;
			const length = Math.hypot(dx, dy, 1);
			const k = (y * size + x) * 4;
			const unit = (c: number) => Math.round((c / length) * 127.5 + 127.5);
			out.normal.set([unit(-dx), unit(-dy), unit(1), 255], k);
		}
	return out;
}

/** The distance from the image's center, 0 there and 1 at the middle of each side. */
const radius = (x: number, y: number) => Math.hypot(x - 0.5, y - 0.5) * 2;

/** A burnt patch: black at its heart, sooty brown toward a ragged edge. */
export function scorch(size = 256, seed = 1): DecalTexels {
	return texels(size, 6, (x, y) => {
		const n = fbm(x, y, seed);
		const r = radius(x, y) + (n - 0.5) * 0.55;
		const burn = ramp(0.75, 0.05, r);
		const soot = 0.02 + 0.09 * ramp(0.1, 0.8, r) * n;
		return {
			r: soot * 1.3,
			g: soot * 1.05,
			b: soot * 0.8,
			a: ramp(1, 0.55, r) * (0.75 + 0.25 * burn),
			rough: 0.95,
			metal: 0,
			height: n * (1 - burn),
		};
	});
}

/** A splash of wet mud: dark brown blobs, glossy where they lie thickest. */
export function mud(size = 256, seed = 2): DecalTexels {
	return texels(size, 10, (x, y) => {
		const n = fbm(x, y, seed, 5, 3);
		const thick = ramp(0.42, 0.62, n - radius(x, y) * 0.45 + 0.2);
		const wet = ramp(0.55, 0.85, thick * fbm(x, y, seed + 9, 3, 6) * 1.6);
		const shade = 0.75 - 0.35 * wet;
		return {
			r: 0.16 * shade,
			g: 0.1 * shade,
			b: 0.055 * shade,
			a: thick,
			rough: 0.75 - 0.5 * wet,
			metal: 0,
			height: thick * 0.6 + n * 0.4,
		};
	});
}

/**
 * A puddle: a dark, mirror-smooth film of water with faint ripples, inside a wide ring of damp
 * ground that fades softly into the dry ground around it.
 */
export function puddle(size = 256, seed = 3): DecalTexels {
	return texels(size, 2, (x, y) => {
		const n = fbm(x, y, seed, 4, 2);
		const r = radius(x, y) + (n - 0.5) * 0.5;
		const water = ramp(0.7, 0.45, r);
		const ripple = fbm(x, y, seed + 4, 3, 16);
		return {
			r: 0.045,
			g: 0.043,
			b: 0.041,
			a: ramp(1, 0.5, r) * (0.7 + 0.28 * water),
			rough: 0.5 - 0.46 * water,
			metal: 0,
			height: ripple * water * 0.3,
		};
	});
}

/** Road paint: a worn white stripe with a hard edge, scuffed by traffic. */
export function roadPaint(size = 256, seed = 4): DecalTexels {
	return texels(size, 4, (x, y) => {
		const edge = Math.min(ramp(0, 0.04, x), ramp(1, 0.96, x), ramp(0, 0.02, y), ramp(1, 0.98, y));
		const wear = ramp(0.7, 0.9, fbm(x * 0.5, y * 2, seed, 5, 4) + fbm(x, y, seed + 5, 3, 16) * 0.3);
		const paint = 0.86 - 0.08 * fbm(x, y, seed + 3, 3, 24);
		return {
			r: paint,
			g: paint * 0.97,
			b: paint * 0.9,
			a: edge * (0.95 - wear * 0.3),
			rough: 0.55,
			metal: 0,
			height: edge * (1 - wear) * 0.2,
		};
	});
}

/** A clump of moss: patchy greens, rough and soft, thickest at its middle. */
export function moss(size = 256, seed = 5): DecalTexels {
	return texels(size, 14, (x, y) => {
		const n = fbm(x, y, seed, 6, 4);
		const clump = ramp(0.38, 0.6, n - radius(x, y) * 0.35 + 0.15);
		const tint = fbm(x, y, seed + 11, 3, 3);
		const fine = fbm(x, y, seed + 21, 2, 48);
		return {
			r: 0.05 + 0.06 * tint,
			g: 0.11 + 0.1 * tint * fine,
			b: 0.02 + 0.02 * fine,
			a: clump,
			rough: 0.92,
			metal: 0,
			height: clump * fine,
		};
	});
}

/** Cracks: a web of dark, deep lines that branch across the surface and fade at the edges. */
export function cracks(size = 256, seed = 6): DecalTexels {
	return texels(size, 18, (x, y) => {
		const wobble = (fbm(x, y, seed, 4, 4) - 0.5) * 0.12;
		const [first, second] = cells(x + wobble, y - wobble, seed, 5);
		const fade = ramp(1, 0.6, radius(x, y));
		const line = ramp(0.12, 0.0, second - first) * fade;
		return {
			r: 0.03,
			g: 0.028,
			b: 0.025,
			a: Math.min(1, line * 1.4),
			rough: 0.9,
			metal: 0,
			height: -line,
		};
	});
}

/** Linear colors for a mix: `from` at 0 to `to` at 1. */
function mix(from: readonly number[], to: readonly number[], t: number): number[] {
	return from.map((c, k) => c + ((to[k] ?? c) - c) * t);
}

/**
 * Bricks where the plaster has fallen off a wall: courses of red bricks in grey mortar, inside a
 * ragged rim of broken plaster. The image's bottom row is the wall's lower side.
 */
export function bricks(size = 256, seed = 7): DecalTexels {
	const [courses, across] = [14, 4.5];
	return texels(size, 8, (x, y) => {
		const shape = fbm(x, y, seed, 5, 3) - radius(x, y) * 0.5 + 0.2;
		const bare = ramp(0.44, 0.47, shape);
		const rim = ramp(0.38, 0.44, shape) * (1 - bare);
		const row = Math.floor(y * courses);
		const u = x * across + (row % 2) * 0.5;
		const brick = Math.floor(u);
		const [fu, fv] = [u - brick, y * courses - row];
		const face = Math.min(
			ramp(0, 0.06, fu),
			ramp(1, 0.94, fu),
			ramp(0, 0.12, fv),
			ramp(1, 0.88, fv),
		);
		const tone = 0.7 + 0.5 * hash(brick, row, seed) + 0.3 * (fbm(x, y, seed + 3, 3, 24) - 0.5);
		const wall = mix([0.3, 0.28, 0.25], [0.3 * tone, 0.1 * tone, 0.06 * tone], face);
		const [r, g, b] = mix(wall, [0.55, 0.5, 0.42], rim) as [number, number, number];
		return {
			r,
			g,
			b,
			a: Math.max(bare, rim),
			rough: 0.9,
			metal: 0,
			height: rim + bare * (0.2 + 0.25 * face),
		};
	});
}

/** Poster palettes: the band across the top and the big disc, as linear colors. */
const POSTERS = [
	[
		[0.6, 0.05, 0.03],
		[0.85, 0.6, 0.05],
	],
	[
		[0.03, 0.15, 0.45],
		[0.8, 0.78, 0.7],
	],
	[
		[0.05, 0.3, 0.1],
		[0.85, 0.3, 0.04],
	],
] as const;

/**
 * A pasted poster, faded and torn: a colored band at the top, a big disc, and lines of print below,
 * on paper with ragged edges and pieces torn off near its foot. `palette` picks its colors.
 */
export function poster(size = 128, seed = 8, palette = 0): DecalTexels {
	const [band, disc] = POSTERS[palette % POSTERS.length] as (typeof POSTERS)[number];
	return texels(size, 3, (x, y) => {
		const tear = (fbm(x, y, seed, 4, 6) - 0.5) * 0.08;
		const sheet = Math.min(
			ramp(0.06, 0.08, x + tear),
			ramp(0.94, 0.92, x - tear),
			ramp(0.04, 0.06, y + tear),
			ramp(0.96, 0.94, y - tear),
		);
		const kept = ramp(0.72, 0.68, fbm(x, y, seed + 2, 4, 3) + Math.max(0, 0.35 - y));
		const inside = x > 0.13 && x < 0.87;
		let color: readonly number[] = [0.72, 0.68, 0.56];
		if (inside && y > 0.74 && y < 0.9) color = band;
		else if (Math.hypot(x - 0.5, y - 0.5) < 0.19) color = disc;
		else if (inside && y > 0.1 && y < 0.3 && (y * 20) % 1 < 0.45) {
			if (hash(Math.floor(x * 14), Math.floor(y * 20), seed) > 0.2) color = [0.04, 0.04, 0.04];
		}
		const aged = 0.7 + 0.3 * fbm(x, y, seed + 5, 4, 4);
		const [r, g, b] = mix(color, [0.6, 0.55, 0.4], 0.25).map((c) => c * aged) as [
			number,
			number,
			number,
		];
		return {
			r,
			g,
			b,
			a: sheet * kept,
			rough: 0.85,
			metal: 0,
			height: sheet * kept * (0.3 + 0.2 * fbm(x, y, seed + 6, 3, 8)),
		};
	});
}

/** Graffiti palettes: the spray paint and its outline, as linear colors. */
const SPRAYS = [
	[
		[0.8, 0.04, 0.45],
		[0.02, 0.02, 0.04],
	],
	[
		[0.04, 0.5, 0.8],
		[0.85, 0.85, 0.8],
	],
] as const;

/**
 * A graffiti tag: a looping stroke of spray paint with an outline and a haze of overspray, made for
 * a box about twice as wide as it is tall. `palette` picks its colors.
 */
export function graffiti(size = 256, seed = 9, palette = 0): DecalTexels {
	const [paint, outline] = SPRAYS[palette % SPRAYS.length] as (typeof SPRAYS)[number];
	// The distance from each texel to the stroke, stamped along the stroke's path.
	const reach = 0.09;
	const span = Math.ceil(reach * size);
	const distance = new Float32Array(size * size).fill(1);
	const steps = 1200;
	for (let i = 0; i <= steps; i++) {
		const t = (i / steps) * Math.PI * 2;
		const px = 0.12 + (0.76 * i) / steps + 0.05 * Math.cos(t * 7 + seed);
		const py = 0.5 + 0.08 * Math.sin(t * 1.5 + seed) + 0.2 * Math.sin(t * 7 + seed);
		const [cx, cy] = [Math.floor(px * size), Math.floor(py * size)];
		for (let y = Math.max(0, cy - span); y <= Math.min(size - 1, cy + span); y++)
			for (let x = Math.max(0, cx - span); x <= Math.min(size - 1, cx + span); x++) {
				const d = Math.hypot((x + 0.5) / size - px, (y + 0.5) / size - py);
				const k = y * size + x;
				if (d < (distance[k] ?? 1)) distance[k] = d;
			}
	}
	return texels(size, 0, (x, y) => {
		const d = distance[Math.floor(y * size) * size + Math.floor(x * size)] ?? 1;
		const body = ramp(0.034, 0.028, d);
		const rim = ramp(0.05, 0.044, d) * (1 - body);
		const shade = 0.85 + 0.3 * fbm(x, y, seed + 1, 3, 8);
		const [r, g, b] = mix(
			outline,
			paint.map((c) => c * shade),
			body / Math.max(body + rim, 1e-6),
		) as [number, number, number];
		return {
			r,
			g,
			b,
			a: Math.max(body + rim, 0.3 * ramp(reach, 0.045, d)),
			rough: 0.6,
			metal: 0,
			height: 0,
		};
	});
}

/**
 * A water stain that runs down a wall from its top edge: dark streaks of uneven length that fade
 * downward and toward the sides. `streaks` sets how many streaks run across the image, so a long
 * line of grime under a cornice takes more of them than a stain under one window sill.
 */
export function stain(size = 128, seed = 10, streaks = 6): DecalTexels {
	return texels(size, 0, (x, y) => {
		const length =
			0.25 +
			0.45 * noise(x * streaks, 0.5, seed, streaks) +
			0.3 * noise(x * streaks * 3, 0.5, seed + 1, streaks * 3);
		const run = ramp(1 - length, 1, y);
		const sides = ramp(0, 0.15, x) * ramp(1, 0.85, x);
		return {
			r: 0.05,
			g: 0.046,
			b: 0.04,
			a: run * run * sides * (0.65 + 0.35 * fbm(x, y, seed + 2, 3, 4)),
			rough: 0.8,
			metal: 0,
			height: 0,
		};
	});
}
