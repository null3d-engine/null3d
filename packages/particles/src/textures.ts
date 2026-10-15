// Particle textures made in code, so a page downloads no image for them: soft glows, sparks, smoke
// puffs that billow and thin over a flipbook, flame tongues, raindrops and leaves. Each one is white,
// or a light shade, with its alpha, so a system's colors tint it. Each function returns the texture
// and its flipbook, which a system's options take as they are.

import { math, Noise, type ParticleFlipbook, type Texture, type Textures } from '@null3d/engine';

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

/** Fractal noise of four octaves, from about 0 to 1. */
function fbm(noise: Noise, x: number, y: number, z: number): number {
	return noise.fbm3(x, y, z, 4) / 1.875 + 0.5;
}

/** 1 at or below `low`, falling smoothly to 0 at or above `high`. */
function fall(x: number, low: number, high: number): number {
	return 1 - math.smoothstep(x, low, high);
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
			const along = fall(Math.abs(v), 0.2, 1);
			out[0] = 1;
			out[1] = across * along;
		});
	},

	/**
	 * Sixteen frames of a smoke puff that billows and thins, for smoke, dust and steam. It plays
	 * once over each particle's life.
	 */
	smoke(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		const noise = new Noise(options.seed ?? 1);
		return atlas(textures, 4, 4, options.size ?? 64, (frame, u, v, out) => {
			const age = frame / 15;
			const r = Math.hypot(u, v);
			const billow = fbm(noise, u * 2.2, v * 2.2 - age * 0.8, age * 1.6);
			const edge = 0.55 + 0.35 * age;
			const body = fall(r + (billow - 0.5) * 0.9, edge - 0.35, edge + 0.25);
			// Lit from above: the top of the puff is lighter than its underside.
			out[0] = 0.72 + 0.28 * math.smoothstep(v + (billow - 0.5), -1, 1);
			out[1] = body * (0.25 + 0.75 * billow) * (1 - 0.55 * age);
		});
	},

	/** Sixteen frames of a flickering flame tongue, for fires, torches and jets. It plays at 24 frames per second. */
	flame(textures: Textures, options: ParticleTextureOptions = {}): ParticleTexture {
		const noise = new Noise(options.seed ?? 1);
		return atlas(
			textures,
			4,
			4,
			options.size ?? 64,
			(frame, u, v, out) => {
				const t = (frame / 16) * Math.PI * 2;
				const lick = fbm(noise, u * 2.5, v * 1.8 - frame * 0.35, Math.sin(t) * 0.5);
				const width = 0.55 * fall(v, -0.6, 1.1) * (0.6 + 0.8 * lick);
				const core = fall(Math.abs(u + (lick - 0.5) * 0.4 * (v + 1)), width * 0.15, width);
				const tip = fall(v + (lick - 0.5) * 0.6, 0.2, 1);
				const base = math.smoothstep(v, -1, -0.7);
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
			out[1] = Math.exp(-u * u * 40) * fall(Math.abs(v), 0.6, 1) * (0.35 + 0.4 * (v + 1));
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
				const inside = fall(Math.abs(x), half - 0.04, half + 0.04);
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
