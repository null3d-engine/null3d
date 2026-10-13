// Particle textures made in code, so a page downloads no image for them: soft glows, sparks, smoke
// puffs that billow and thin over a flipbook, flame tongues, raindrops and leaves. Each one is white,
// or a light shade, with its alpha, so a system's colors tint it. Each function returns the texture
// and its flipbook, which a system's options take as they are.

import type { ParticleFlipbook, Texture, Textures } from '@null3d/engine';

/**
 * A particle texture made in code, and its flipbook, which `createParticles` takes in its options:
 * `{ ...particleTextures.smoke(textures), ... }`.
 *
 * @category api/particles
 */
export interface ParticleTexture {
	/** The texture: white or light shades, with alpha. */
	map: Texture;
	/** Its frames. */
	flipbook: ParticleFlipbook;
}

/**
 * Options of the particle textures made in code.
 *
 * @category api/particles
 */
export interface ParticleTextureOptions {
	/** Texels along each side of one frame. The default suits the texture, from 32 to 64. */
	size?: number;
	/** The seed of the texture's random shapes. The default is 1. */
	seed?: number;
}

/** A hash of three whole numbers to a number from 0 up to 1. */
function hash3(x: number, y: number, z: number): number {
	let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}

/** Smooth value noise in 3D, from 0 to 1. */
function noise(x: number, y: number, z: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fy = y - iy;
	const fz = z - iz;
	const ux = fx * fx * (3 - 2 * fx);
	const uy = fy * fy * (3 - 2 * fy);
	const uz = fz * fz * (3 - 2 * fz);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const plane = (z0: number) =>
		lerp(
			lerp(hash3(ix, iy, z0), hash3(ix + 1, iy, z0), ux),
			lerp(hash3(ix, iy + 1, z0), hash3(ix + 1, iy + 1, z0), ux),
			uy,
		);
	return lerp(plane(iz), plane(iz + 1), uz);
}

/** Fractal noise of four octaves, from about 0 to 1. */
function fbm(x: number, y: number, z: number): number {
	let sum = 0;
	let amplitude = 0.5;
	let scale = 1;
	for (let k = 0; k < 4; k++) {
		sum += amplitude * noise(x * scale, y * scale, z * scale + k * 17.1);
		amplitude *= 0.5;
		scale *= 2.03;
	}
	return sum / 0.9375;
}

/** A value from 0 to 1 that eases from 0 at `a` to 1 at `b`. */
function smooth(a: number, b: number, x: number): number {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
}

/**
 * Makes a texture of `columns` by `rows` frames of `size` texels each. `shade` gives a frame's
 * texel at (u, v), each from -1 to 1 with v up, as [light, alpha] from 0 to 1.
 */
function atlas(
	textures: Textures,
	columns: number,
	rows: number,
	size: number,
	shade: (frame: number, u: number, v: number, out: Float32Array) => void,
	flipbook: Omit<ParticleFlipbook, 'columns' | 'rows'> = {},
): ParticleTexture {
	const width = columns * size;
	const height = rows * size;
	const data = new Uint8Array(width * height * 4);
	const out = new Float32Array(2);
	for (let frame = 0; frame < columns * rows; frame++) {
		const cx = (frame % columns) * size;
		// Frame 0 is the top left one, and the first row of texels is the image's bottom.
		const cy = (rows - 1 - Math.floor(frame / columns)) * size;
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				shade(frame, ((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1, out);
				const at = ((cy + y) * width + cx + x) * 4;
				const light = Math.round(Math.min(Math.max(out[0] as number, 0), 1) * 255);
				data[at] = light;
				data[at + 1] = light;
				data[at + 2] = light;
				data[at + 3] = Math.round(Math.min(Math.max(out[1] as number, 0), 1) * 255);
			}
	}
	const map = textures.fromData({ width, height, data, mipmaps: true, wrap: 'clamp' });
	return { map, flipbook: { columns, rows, ...flipbook } };
}

/**
 * Particle textures made in code. Each takes the sketch's `textures` and returns a texture with
 * its flipbook.
 *
 * @category api/particles
 */
export const particleTextures = {
	/** A soft glow with a bright core, for fireflies, embers and magic. */
	glow(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		return atlas(textures, 1, 1, options.size ?? 64, (_, u, v, out) => {
			const r = Math.hypot(u, v);
			out[0] = 1;
			out[1] = Math.exp(-r * r * 9) * 0.85 + Math.max(0, 1 - r) ** 4 * 0.15;
		});
	},

	/** A streak, bright along its middle, for sparks and tracers. Use it with the `velocity` facing. */
	spark(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		return atlas(textures, 1, 1, options.size ?? 32, (_, u, v, out) => {
			const across = Math.exp(-u * u * 18);
			const along = smooth(1, 0.2, Math.abs(v));
			out[0] = 1;
			out[1] = across * along;
		});
	},

	/**
	 * Sixteen frames of a smoke puff that billows and thins, for smoke, dust and steam. It plays
	 * once over each particle's life.
	 */
	smoke(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		const seed = options.seed ?? 1;
		return atlas(textures, 4, 4, options.size ?? 64, (frame, u, v, out) => {
			const age = frame / 15;
			const r = Math.hypot(u, v);
			const billow = fbm(u * 2.2 + seed * 7.3, v * 2.2 - age * 0.8, age * 1.6 + seed);
			const edge = 0.55 + 0.35 * age;
			const body = smooth(edge + 0.25, edge - 0.35, r + (billow - 0.5) * 0.9);
			// Lit from above: the top of the puff is lighter than its underside.
			out[0] = 0.72 + 0.28 * smooth(-1, 1, v + (billow - 0.5));
			out[1] = body * (0.25 + 0.75 * billow) * (1 - 0.55 * age);
		});
	},

	/** Sixteen frames of a flickering flame tongue, for fires, torches and jets. It plays at 24 frames per second. */
	flame(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		const seed = options.seed ?? 1;
		return atlas(
			textures,
			4,
			4,
			options.size ?? 64,
			(frame, u, v, out) => {
				const t = (frame / 16) * Math.PI * 2;
				const lick = fbm(u * 2.5 + seed, v * 1.8 - frame * 0.35, Math.sin(t) * 0.5 + seed);
				const width = 0.55 * smooth(1.1, -0.6, v) * (0.6 + 0.8 * lick);
				const core = smooth(width, width * 0.15, Math.abs(u + (lick - 0.5) * 0.4 * (v + 1)));
				const tip = smooth(1, 0.2, v + (lick - 0.5) * 0.6);
				const base = smooth(-1, -0.7, v);
				out[0] = 0.75 + 0.25 * core;
				out[1] = core * tip * base;
			},
			{ fps: 24, randomStart: true },
		);
	},

	/** A thin raindrop streak, for rain. Use it with the `velocity` facing. */
	rain(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		return atlas(textures, 1, 1, options.size ?? 32, (_, u, v, out) => {
			out[0] = 0.85 + 0.15 * (v + 1) * 0.5;
			out[1] = Math.exp(-u * u * 40) * smooth(1, 0.6, Math.abs(v)) * (0.35 + 0.4 * (v + 1));
		});
	},

	/**
	 * Four leaves of different shapes, each with a midrib and veins, for falling leaves and petals.
	 * Each particle keeps one leaf: give the system a random first frame that holds.
	 */
	leaves(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		return atlas(
			textures,
			2,
			2,
			options.size ?? 64,
			(frame, u, v, out) => {
				// A leaf along v: its half-width over its length, from a narrow willow to a round birch.
				const round = [0.42, 0.62, 0.32, 0.5][frame] as number;
				const tipBend = [0.1, -0.08, 0.15, 0][frame] as number;
				const x = u - tipBend * (v + 1) ** 2 * 0.25;
				const along = (v + 0.95) / 1.85;
				const half = round * Math.sin(Math.PI * Math.min(Math.max(along, 0), 1)) ** 0.8;
				const inside = smooth(half + 0.04, half - 0.04, Math.abs(x));
				const stem = along < 0 && along > -0.06 && Math.abs(x) < 0.03 ? 1 : 0;
				const rib = Math.exp(-x * x * 900);
				const offset = ((Math.abs(x) * 1.6 - along * 4 + 10) % 0.5) - 0.25;
				const vein = Math.exp(-offset * offset * 400);
				out[0] = 0.78 + 0.22 * along - 0.25 * rib - 0.12 * vein * inside;
				out[1] = Math.max(inside, stem);
			},
			{ randomStart: true, hold: true },
		);
	},
};
