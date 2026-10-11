// Particles for the comparison scenes: rain, steam, exhaust and the soft glows around lamps. Each
// particle is a square that faces the camera, with a position, a size and a color. A scene writes
// the rows of each system in closed form from the simulation time, into arrays that the engine owns,
// and each engine draws them its own way: null3D as a sprite batch, and three.js as instanced
// points. This module holds the small interface that both engines' particle code meets, and the
// textures that the systems share, with no engine imports. A particle add-on can take the place of
// an engine's sprites behind the same interface.

import { byte, clamp, hash01, type TextureData, tiledNoise } from './compare-scene';

/** How a particle system draws: what each particle shows and how it blends with the scene. */
export interface ParticleLook {
	/** A name for errors and the engines' own tools. */
	name: string;
	/** The most particles the system holds. */
	capacity: number;
	/** The picture of each particle, square, in sRGB with alpha. */
	texture: TextureData;
	/** 'additive' for light, such as glows and sparks; 'normal' for rain, steam and smoke. */
	blending: 'normal' | 'additive';
	/** True puts the particles in the scene's fog. */
	fog: boolean;
}

/**
 * The rows of a system, in arrays of the engine's memory. Read them from `rows()` in every frame,
 * as an engine may move them. Particle i has its position at `i * 3`, its width and height in meters
 * at `i * 2`, and its linear color and alpha at `i * 4`. The scenes draw square particles, so an
 * engine that draws only squares takes the height.
 */
export interface ParticleRows {
	positions: Float32Array;
	sizes: Float32Array;
	colors: Float32Array;
}

/** A particle system of an engine. */
export interface Particles {
	/** The rows to write in this frame. */
	rows(): ParticleRows;
	/** Draws the first `count` particles, after the rows of this frame are written. */
	commit(count: number): void;
}

/** Makes an engine's particle system for a look. */
export type ParticleMaker = (look: ParticleLook) => Promise<Particles>;

// The textures that the systems share: white pictures that each particle's color tints.

/** A raindrop's streak: a thin line down the middle of the square, brightest at its center. */
export function rainTexture(size = 32): TextureData {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const across = Math.abs((x + 0.5) / size - 0.5) * size;
			const along = Math.abs((y + 0.5) / size - 0.5) * 2;
			const alpha = clamp(1 - across / 1.2, 0, 1) * clamp((1 - along) * 1.6, 0, 1);
			data.set([255, 255, 255, byte(alpha)], (y * size + x) * 4);
		}
	return { size, data, colorSpace: 'srgb' };
}

/** A puff of steam or smoke: a soft round cloud with a ragged edge. */
export function puffTexture(size = 64, seed = 5): TextureData {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = (x + 0.5) / size - 0.5;
			const v = (y + 0.5) / size - 0.5;
			const r = Math.hypot(u, v) * 2;
			const ragged = 0.55 * tiledNoise(u * 6 + 3, v * 6 + 3, 64, seed) + 0.45 * hash01(seed, x, y);
			const alpha = clamp(1 - r, 0, 1) ** 1.6 * (0.55 + 0.45 * ragged);
			data.set([255, 255, 255, byte(alpha)], (y * size + x) * 4);
		}
	return { size, data, colorSpace: 'srgb' };
}

/** A glow around a light in fog: a bright core that falls away smoothly to the edge. */
export function glowTexture(size = 64): TextureData {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
			const falloff = clamp(1 - r, 0, 1);
			const alpha = falloff * falloff * (0.35 + 0.65 * falloff * falloff);
			data.set([255, 255, 255, byte(alpha)], (y * size + x) * 4);
		}
	return { size, data, colorSpace: 'srgb' };
}
