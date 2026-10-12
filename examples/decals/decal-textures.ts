// Decal images made in code: scorch marks, mud, puddles, road paint, moss and cracks. Each comes as
// texel data for `textures.fromData`: a base color map with alpha in sRGB, a map with roughness in
// green and metalness in blue, and a normal map, each `size` texels on a side. Every pattern comes
// from a seeded hash, so each run makes the same images.

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

/** Smooth value noise from 0 to 1, which repeats every `period` units. */
function noise(x: number, y: number, seed: number, period: number): number {
	const [x0, y0] = [Math.floor(x), Math.floor(y)];
	const [fx, fy] = [x - x0, y - y0];
	const [u, v] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
	const at = (i: number, j: number) => hash((x0 + i) % period, (y0 + j) % period, seed);
	const top = at(0, 0) + (at(1, 0) - at(0, 0)) * u;
	const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * u;
	return top + (bottom - top) * v;
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

/** A share from 0 at `low` to 1 at `high`, smoothed at both ends. */
function ramp(low: number, high: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
	return t * t * (3 - 2 * t);
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

/** A puddle: a dark, smooth film of water, which wets the ground at its ragged edge. */
export function puddle(size = 256, seed = 3): DecalTexels {
	return texels(size, 1.5, (x, y) => {
		const n = fbm(x, y, seed, 4, 2);
		const r = radius(x, y) + (n - 0.5) * 0.5;
		const water = ramp(0.8, 0.55, r);
		const ripple = fbm(x, y, seed + 4, 3, 12);
		return {
			r: 0.025,
			g: 0.028,
			b: 0.032,
			a: ramp(1, 0.75, r) * 0.92,
			rough: 0.5 - 0.47 * water,
			metal: 0,
			height: ripple * water * 0.05,
		};
	});
}

/** Road paint: a worn white stripe with a hard edge, scuffed by traffic. */
export function roadPaint(size = 256, seed = 4): DecalTexels {
	return texels(size, 4, (x, y) => {
		const edge = Math.min(ramp(0, 0.04, x), ramp(1, 0.96, x), ramp(0, 0.02, y), ramp(1, 0.98, y));
		const wear = ramp(
			0.62,
			0.85,
			fbm(x * 0.5, y * 2, seed, 5, 4) + fbm(x, y, seed + 5, 3, 16) * 0.3,
		);
		const paint = 0.86 - 0.08 * fbm(x, y, seed + 3, 3, 24);
		return {
			r: paint,
			g: paint * 0.97,
			b: paint * 0.9,
			a: edge * (0.95 - wear * 0.45),
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
