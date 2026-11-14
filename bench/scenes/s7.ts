// S7, the reflection: one paved surface under a sky with a layer over it. The camera stands still
// and looks along the ground, so the lower part of the frame is the surface's reflection of the sky
// and of the layer that hangs in it. Nothing in the scene moves, so two runs of the benchmark differ
// only by the page's switch that leaves the surface without the sky's light, which is the
// reflection.
//
// Everything here is plain data and pure functions with no engine imports, as in spec.ts. The
// per-frame function writes into arrays that the caller owns, so it allocates nothing.
import type { OutArray } from './spec';

/**
 * The paved surface: a square plane 4 km on each side, at ground level. Its far edge lies within a
 * pixel of the horizon from the camera's height, so the surface fills the ground to the horizon.
 */
export const S7_PLANE = { width: 4000, height: 4000 } as const;

/** The camera: it looks along the surface, so most of the ground shows at a grazing angle. */
export const S7_CAMERA = {
	fov: 55,
	near: 0.5,
	far: 4000,
	position: [0, 2.4, 20],
	target: [0, 4, -60],
} as const;

/** The sky: clear, with the sun ahead of the camera and low, so the sky is bright where the surface reflects it. */
export const S7_SKY = {
	sunPosition: [-0.4, 0.6, -0.7],
	cloudCoverage: 0,
	showSunDisc: false,
	mieCoefficient: 0.005,
} as const;

/** The sun's light: its direction is the way the light travels, away from the sun's place in the sky. */
export const S7_SUN = {
	direction: [0.4, -0.6, 0.7],
	color: '#fff1dc',
	intensity: 2.5,
} as const;

/**
 * The surface: a wet grey stone of a low roughness, which mirrors the sky at the grazing angles that
 * the camera sees most of it at, and shows its own colour straight down.
 */
export const S7_SURFACE = { color: '#ffffff', roughness: 0.12, metalness: 0 } as const;

/** The light that fills the surface where the sky's own light is not asked for. */
export const S7_AMBIENT = { color: '#ffffff', intensity: 0.25 } as const;

/**
 * The paving: a texture of stone tiles with dark joints, its texels across, its tiles on each side,
 * and the times it repeats across the surface. The repeat makes one stone about a metre across.
 */
export const S7_PAVING = { size: 128, tiles: 4, repeat: 1000 } as const;

/** The paving's stone shades, from light to dark, one for each tile of the texture. */
const PAVING_SHADES = [
	148, 158, 166, 140, 172, 152, 162, 144, 168, 156, 150, 170, 146, 160, 154, 164,
];
/** The joint's shade, and its width in texels. */
const JOINT_SHADE = 92;
const JOINT_WIDTH = 2;

/**
 * The paving texture's RGBA texels: a grid of stone tiles in a fixed pattern of shades, each tile
 * edged by a darker joint. The same texels give the same surface in every run and in both engines.
 */
export function s7Paving(): { width: number; height: number; data: Uint8Array } {
	const { size, tiles } = S7_PAVING;
	const tile = size / tiles;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const cell = Math.floor(x / tile) + tiles * Math.floor(y / tile);
			const joint = x % tile < JOINT_WIDTH || y % tile < JOINT_WIDTH;
			const shade = joint ? JOINT_SHADE : (PAVING_SHADES[cell % PAVING_SHADES.length] as number);
			const at = (y * size + x) * 4;
			data[at] = shade;
			data[at + 1] = shade;
			data[at + 2] = shade + 4;
			data[at + 3] = 255;
		}
	}
	return { width: size, height: size, data };
}

/** The scene's objects: the one surface. */
export const S7_COUNT = 1;

/** Writes the camera's position and target. The camera never moves, so every frame is the same. */
export function s7Camera(_t: number, outPosition: OutArray, outTarget: OutArray): void {
	const { position, target } = S7_CAMERA;
	outPosition[0] = position[0];
	outPosition[1] = position[1];
	outPosition[2] = position[2];
	outTarget[0] = target[0];
	outTarget[1] = target[1];
	outTarget[2] = target[2];
}
