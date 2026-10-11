// Particles as plain rows of sprites, which a scene's own code fills each frame and each engine then
// draws. A scene describes a layer of sprites (its capacity, its blending and its atlas, made in
// code), and writes each live particle's position, size, turn, color and atlas frame into the
// layer's rows. null3D draws a layer as one sprite batch (examples/lib/particles-null3d.ts), and
// three.js as one instanced quad with a sprite shader (examples/lib/particles-three.ts). The rows
// keep the simulation out of both engines, so a layer can move to the particles add-on by
// replacing only the null3D side.

import { clamp, hash01, lerp, type TextureData } from './compare-scene';

/** How a layer of sprites draws. */
export interface SpriteLayer {
	/** The most sprites that the layer draws at once. */
	capacity: number;
	/** 'additive' adds light, for fire and sparks; 'normal' blends over what lies behind, for smoke. */
	blending: 'additive' | 'normal';
	/** The atlas's grid of frames, and its texels in sRGB with alpha. */
	atlas: { columns: number; rows: number; texture: TextureData };
	/** False keeps the sprites out of the scene's fog, as glowing particles look. */
	fog: boolean;
}

/** A layer's rows: the arrays that a scene fills each frame, and how many rows are live. */
export interface SpriteRows {
	/** Three floats per sprite: its center in the world. */
	positions: Float32Array;
	/** Two floats per sprite: its width and height in meters. */
	sizes: Float32Array;
	/** One float per sprite: its turn on the screen in radians, counterclockwise. */
	rotations: Float32Array;
	/** Four floats per sprite: a linear color that multiplies the atlas, and its alpha. */
	colors: Float32Array;
	/** One whole number per sprite: its frame of the atlas, row by row from the top left. */
	frames: Uint32Array;
	/** The live rows, which come first. */
	count: number;
}

export function createSpriteRows(capacity: number): SpriteRows {
	return {
		positions: new Float32Array(capacity * 3),
		sizes: new Float32Array(capacity * 2),
		rotations: new Float32Array(capacity),
		colors: new Float32Array(capacity * 4),
		frames: new Uint32Array(capacity),
		count: 0,
	};
}

/**
 * Adds one sprite to the rows, unless they are full. Returns false when full. Allocates nothing.
 */
export function addSprite(
	rows: SpriteRows,
	x: number,
	y: number,
	z: number,
	size: number,
	rotation: number,
	r: number,
	g: number,
	b: number,
	a: number,
	frame: number,
): boolean {
	const i = rows.count;
	if (i >= rows.frames.length) return false;
	rows.positions[i * 3] = x;
	rows.positions[i * 3 + 1] = y;
	rows.positions[i * 3 + 2] = z;
	rows.sizes[i * 2] = size;
	rows.sizes[i * 2 + 1] = size;
	rows.rotations[i] = rotation;
	rows.colors[i * 4] = r;
	rows.colors[i * 4 + 1] = g;
	rows.colors[i * 4 + 2] = b;
	rows.colors[i * 4 + 3] = a;
	rows.frames[i] = frame;
	rows.count = i + 1;
	return true;
}

// Atlases made in code. Each frame keeps a clear border, so filtering never bleeds into the next.

/** Smooth noise over the plane, from 0 to 1, that does not tile. */
function noise(x: number, y: number, seed: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const top = lerp(hash01(seed, x0, y0), hash01(seed, x0 + 1, y0), sx);
	const bottom = lerp(hash01(seed, x0, y0 + 1), hash01(seed, x0 + 1, y0 + 1), sx);
	return lerp(top, bottom, sy);
}

function turbulence(x: number, y: number, seed: number): number {
	let sum = 0;
	let weight = 0.5;
	for (let o = 0; o < 4; o++) {
		sum += weight * noise(x * 2 ** o, y * 2 ** o, seed + o * 13);
		weight *= 0.5;
	}
	return sum / 0.9375;
}

/** Writes an atlas, frame by frame, from a function of the point in the frame (-1 to 1 each way). */
function atlas(
	columns: number,
	rows: number,
	frameSize: number,
	texel: (frame: number, x: number, y: number) => readonly [number, number, number, number],
): TextureData {
	const width = columns * frameSize;
	const height = rows * frameSize;
	const data = new Uint8Array(width * height * 4);
	const byte = (v: number) => Math.round(clamp(v, 0, 1) * 255);
	for (let row = 0; row < rows; row++)
		for (let column = 0; column < columns; column++) {
			const frame = row * columns + column;
			for (let py = 0; py < frameSize; py++)
				for (let px = 0; px < frameSize; px++) {
					// The frame's own coordinates, with a border of 4% left clear.
					const x = ((px + 0.5) / frameSize) * 2.08 - 1.04;
					const y = ((py + 0.5) / frameSize) * 2.08 - 1.04;
					const [r, g, b, a] = texel(frame, x, y);
					// Frame 0 is the top left frame of the upright image: texel rows run from the top.
					const at = ((row * frameSize + py) * width + column * frameSize + px) * 4;
					data[at] = byte(r);
					data[at + 1] = byte(g);
					data[at + 2] = byte(b);
					data[at + 3] = byte(a);
				}
		}
	if (width !== height) throw new RangeError('An atlas is square.');
	return { size: width, data, colorSpace: 'srgb' };
}

/** Frames of the fire atlas: 12 frames of a fireball's life, then muzzle flashes and a spark. */
export const FIRE_FRAMES = {
	ball: 0,
	ballFrames: 12,
	flash: 12,
	flashFrames: 3,
	spark: 15,
} as const;

/**
 * The fire atlas, 4 x 4 frames: a fireball from a white-hot burst to a dull, broken glow, three
 * star-shaped muzzle flashes, and a round spark. For additive layers: the alpha is the coverage, and
 * the color is already dark where the fire is thin.
 */
export function fireAtlas(frameSize = 64): SpriteLayer['atlas'] {
	const texture = atlas(4, 4, frameSize, (frame, x, y) => {
		const r = Math.hypot(x, y);
		if (frame === FIRE_FRAMES.spark) {
			const glow = clamp(1 - r, 0, 1) ** 2.5;
			return [1, 0.85, 0.6, glow];
		}
		if (frame >= FIRE_FRAMES.flash) {
			// A bright core with four or five spikes, turned per frame.
			const spikes = 4 + (frame % 2);
			const angle = Math.atan2(y, x) + frame;
			const spike = Math.abs(Math.cos((angle * spikes) / 2)) ** 8;
			const glow = clamp(1 - r / (0.25 + 0.75 * spike), 0, 1) ** 1.6;
			return [1, 0.9, 0.65, glow];
		}
		// A fireball at life t: billowing turbulence that grows, cools from white to red, and breaks.
		const t = frame / (FIRE_FRAMES.ballFrames - 1);
		const n = turbulence(x * 2.2 + 3 * t, y * 2.2 - 2 * t, 11 + frame * 3);
		const edge = 0.55 + 0.35 * t + 0.25 * (n - 0.5);
		const body = clamp((edge - r) / 0.25, 0, 1) * clamp(1.15 - t * 0.9 + (n - 0.5) * 0.8 * t, 0, 1);
		const heat = clamp(1 - r / edge, 0, 1) * (1 - t) ** 1.2;
		const red = clamp(0.35 + 0.65 * body + heat, 0, 1);
		const green = clamp(0.12 + 0.55 * body * (1 - 0.5 * t) + heat * 0.9, 0, 1);
		const blue = clamp(0.03 + 0.25 * heat * heat, 0, 1);
		return [red * body, green * body, blue * body, body];
	});
	return { columns: 4, rows: 4, texture };
}

/**
 * The smoke atlas, 2 x 2 frames: four soft puffs of billowing smoke, white so each sprite's color
 * tints it, with alpha that thins toward the edge.
 */
export function smokeAtlas(frameSize = 96): SpriteLayer['atlas'] {
	const texture = atlas(2, 2, frameSize, (frame, x, y) => {
		const r = Math.hypot(x, y);
		const n = turbulence(x * 2.5 + frame * 7, y * 2.5 - frame * 3, 29 + frame);
		const density = clamp((0.85 - r + 0.35 * (n - 0.5)) / 0.45, 0, 1) ** 1.5;
		// Lit from above: lighter at the top of the puff.
		const shade = 0.72 + 0.28 * clamp(0.5 - y * 0.5 + (n - 0.5) * 0.4, 0, 1);
		return [shade, shade, shade, density * (0.55 + 0.45 * n)];
	});
	return { columns: 2, rows: 2, texture };
}
