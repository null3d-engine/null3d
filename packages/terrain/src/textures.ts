// The ground's layer maps, made in code: grass, soil, rock and snow as tiling color maps, each
// built once from seeded noise so every run gives the same ground. A caller may use these, give
// its own maps, or mix the two.
import type { SketchContext, Texture } from '@null3d/engine';

/**
 * How to make the layer maps.
 *
 * @category api/terrain
 */
export interface TerrainTextureOptions {
	/** The texels along each side of every map. The default is 128. */
	size?: number;
	/** The seed of the noise. The default is 1. */
	seed?: number;
}

/**
 * The four layer maps, ready for `TerrainLayer.map`.
 *
 * @category api/terrain
 */
export interface TerrainTextures {
	/** Dark green blades on a lighter green ground: the layer of the low, gentle ground. */
	grass: Texture;
	/** Dry brown earth with small stones: the layer of the higher, dry ground. */
	soil: Texture;
	/** Gray rock, broken into facets: the layer of the steep slopes. */
	rock: Texture;
	/** Near-white, faintly blue snow with a little grain: the layer of the high ground. */
	snow: Texture;
}

/** A seeded generator of numbers from 0 to 1 (mulberry32). */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Tiling value noise in two dimensions, from -1 to 1, so a map made from it repeats. */
class Noise {
	private readonly perm = new Uint8Array(512);
	private readonly values = new Float32Array(256);

	constructor(seed: number) {
		const next = random(seed);
		const order = Array.from({ length: 256 }, (_, i) => i);
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			[order[i], order[j]] = [order[j] as number, order[i] as number];
		}
		for (let i = 0; i < 512; i++) this.perm[i] = order[i & 255] as number;
		for (let i = 0; i < 256; i++) this.values[i] = next() * 2 - 1;
	}

	private lattice(x: number, y: number): number {
		const { perm } = this;
		return this.values[perm[(perm[x & 255] as number) + (y & 255)] as number] as number;
	}

	private value2(x: number, y: number, period: number): number {
		const fx = Math.floor(x);
		const fy = Math.floor(y);
		const tx = smooth(x - fx);
		const ty = smooth(y - fy);
		const x0 = ((fx % period) + period) % period;
		const y0 = ((fy % period) + period) % period;
		const x1 = (x0 + 1) % period;
		const y1 = (y0 + 1) % period;
		return lerp(
			lerp(this.lattice(x0, y0), this.lattice(x1, y0), tx),
			lerp(this.lattice(x0, y1), this.lattice(x1, y1), tx),
			ty,
		);
	}

	/** Octaves of tiling noise, each twice as fine and half as strong. */
	fbm2(x: number, y: number, octaves: number, period: number): number {
		let sum = 0;
		let amplitude = 0.5;
		let scale = 1;
		for (let o = 0; o < octaves; o++) {
			sum += amplitude * this.value2(x * scale, y * scale, period * scale);
			amplitude *= 0.5;
			scale *= 2;
		}
		return sum;
	}
}

/** Makes a tiling sRGB color map, calling `sample` once per texel with the texel's u and v. */
function colorMap(
	textures: SketchContext['textures'],
	size: number,
	sample: (u: number, v: number, out: number[]) => void,
): Texture {
	const data = new Uint8Array(size * size * 4);
	const rgb = [0, 0, 0];
	const byte = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255);
	for (let i = 0; i < size * size; i++) {
		sample(((i % size) + 0.5) / size, (Math.floor(i / size) + 0.5) / size, rgb);
		data.set([byte(rgb[0] as number), byte(rgb[1] as number), byte(rgb[2] as number), 255], i * 4);
	}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
		anisotropy: 8,
	});
}

/**
 * Makes the four layer maps in code. Each is `size` texels across and repeats; the noise tiles, so
 * the maps do too, and the same seed gives the same maps on every run.
 *
 * @category api/terrain
 */
export function terrainTextures(
	textures: SketchContext['textures'],
	options: TerrainTextureOptions = {},
): TerrainTextures {
	const size = options.size ?? 128;
	const noise = new Noise(options.seed ?? 1);
	const grass = colorMap(textures, size, (u, v, out) => {
		const clumps = noise.fbm2(u * 12, v * 12, 4, 12);
		const blades = noise.fbm2(u * 40, v * 40, 2, 40);
		const green = 0.5 + 0.22 * clumps + 0.08 * blades;
		out[0] = 0.16 + 0.1 * green;
		out[1] = 0.32 + 0.34 * green;
		out[2] = 0.1 + 0.07 * green;
	});
	const soil = colorMap(textures, size, (u, v, out) => {
		const clods = noise.fbm2(u * 10, v * 10, 4, 10);
		const grit = noise.fbm2(u * 36, v * 36, 2, 36);
		const stone = smooth(Math.min(Math.max(grit * 0.5 + 0.5, 0), 1));
		const tone = 0.62 + 0.2 * clods + 0.16 * stone;
		out[0] = 0.45 * tone;
		out[1] = 0.36 * tone;
		out[2] = 0.26 * tone;
	});
	const rock = colorMap(textures, size, (u, v, out) => {
		const facets = noise.fbm2(u * 8, v * 8, 3, 8);
		const cracks = Math.abs(noise.fbm2(u * 20, v * 20, 3, 20));
		const tone = 0.5 + 0.28 * facets - 0.22 * (1 - cracks);
		out[0] = tone;
		out[1] = tone * 0.98;
		out[2] = tone * 0.95;
	});
	const snow = colorMap(textures, size, (u, v, out) => {
		const drift = noise.fbm2(u * 14, v * 14, 3, 14);
		const grain = noise.fbm2(u * 48, v * 48, 2, 48);
		const tone = 0.88 + 0.08 * drift + 0.04 * grain;
		out[0] = tone * 0.97;
		out[1] = tone * 0.99;
		out[2] = Math.min(tone, 1);
	});
	return { grass, soil, rock, snow };
}
