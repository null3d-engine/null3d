// The sprites' scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports. Blended sprites show
// frames of an atlas at several sizes, rotations, colors and depths, in front of a wall, and some
// overlap, so both engines must sort them back to front. Opaque sprites with no map keep a size in
// pixels at every distance and stand on their positions. three.js draws each sprite as a `Sprite`
// with a `SpriteMaterial` of its own.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const SPRITE_IMAGE = PARITY_CANVAS;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const SPRITE_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 100,
	position: [0, 1.6, 6],
	target: [0, 1, 0],
} as const;

/** A box: its size along x, y and z, its center and its sRGB color, lit by the scene's lights. */
export interface SpriteBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

/** The floor and the wall behind the sprites. */
export const SPRITE_BOXES: readonly SpriteBox[] = [
	{ size: [10, 0.2, 8], position: [0, -0.1, 0], color: '#8a8f99' },
	{ size: [8, 4, 0.3], position: [0, 2, -2], color: '#4a8cff' },
];

/** The atlas: columns and rows of frames, and the pixels on each side of a frame. */
export const SPRITE_ATLAS = { columns: 4, rows: 2, frame: 16 } as const;

/** Each frame's color, frame 0 first: frames count along the top row, then the next. */
const FRAME_COLORS = [
	'#e8554e',
	'#f2c14e',
	'#5bc27a',
	'#4a8cff',
	'#b06ce0',
	'#fafafa',
	'#ff8a3d',
	'#3dd6d0',
];

/**
 * The atlas picture as rows of CSS colors, top row first, one color per pixel: each frame holds a
 * disc of its color on a clear ground, with a white bar above its middle that shows which way is
 * up. A clear border keeps each frame's texels apart from its neighbors' when the map filters.
 */
export function spriteAtlasRows(): string[][] {
	const { columns, rows, frame } = SPRITE_ATLAS;
	const clear = 'rgba(0, 0, 0, 0)';
	const picture: string[][] = [];
	for (let y = 0; y < rows * frame; y++) {
		const row: string[] = [];
		for (let x = 0; x < columns * frame; x++) {
			const color = FRAME_COLORS[Math.floor(y / frame) * columns + Math.floor(x / frame)];
			const [u, v] = [(x % frame) - frame / 2 + 0.5, (y % frame) - frame / 2 + 0.5];
			const bar = Math.abs(u) < 1.5 && v > -6.5 && v < -3;
			row.push(bar ? '#ffffff' : u * u + v * v < 36 ? (color ?? clear) : clear);
		}
		picture.push(row);
	}
	return picture;
}

/** A sprite: its position, width and height, rotation in radians, sRGB color, alpha and frame. */
export interface SpriteSpec {
	position: Vec3;
	size: readonly [number, number];
	rotation: number;
	color: string;
	alpha: number;
	frame: number;
}

/** The blended sprites, sized in world units, which show the atlas's frames. */
export const WORLD_SPRITES: readonly SpriteSpec[] = [
	{ position: [-2.4, 1, 0], size: [1, 1], rotation: 0, color: '#ffffff', alpha: 1, frame: 0 },
	{
		position: [-1.2, 1.3, 0.5],
		size: [0.8, 0.8],
		rotation: 0.4,
		color: '#ffffff',
		alpha: 1,
		frame: 1,
	},
	{ position: [0, 1, 0], size: [1.2, 1.2], rotation: -0.3, color: '#ffd080', alpha: 0.9, frame: 2 },
	{
		position: [0.3, 1.2, 1],
		size: [0.9, 0.9],
		rotation: 0,
		color: '#80ffff',
		alpha: 0.6,
		frame: 3,
	},
	{
		position: [1.3, 0.8, -0.5],
		size: [1, 0.6],
		rotation: 0.8,
		color: '#ffffff',
		alpha: 1,
		frame: 4,
	},
	{
		position: [2.4, 1.1, 0.2],
		size: [0.7, 1.1],
		rotation: 0,
		color: '#ffffff',
		alpha: 0.8,
		frame: 5,
	},
	{ position: [-0.6, 2.2, -1], size: [1, 1], rotation: 2, color: '#ff80ff', alpha: 1, frame: 6 },
	{ position: [1, 2.3, -1.2], size: [1, 1], rotation: -1, color: '#ffffff', alpha: 0.7, frame: 7 },
];

/**
 * The opaque sprites with no map, sized in CSS pixels at every distance, which stand on their
 * positions: the anchor is the middle of their bottom edge.
 */
export const SCREEN_SPRITES: readonly SpriteSpec[] = [
	{ position: [-2, 0.2, 2], size: [24, 40], rotation: 0, color: '#e8554e', alpha: 1, frame: 0 },
	{ position: [0, 0.2, 2.5], size: [30, 30], rotation: 0.5, color: '#5bc27a', alpha: 1, frame: 0 },
	{ position: [2, 0.2, 1.5], size: [40, 24], rotation: -0.3, color: '#f2c14e', alpha: 1, frame: 0 },
];

/** The anchor of the screen-sized sprites: the middle of their bottom edge. */
export const SCREEN_CENTER = [0.5, 0] as const;

/**
 * The scale that gives a three.js sprite without size attenuation `pixels` CSS pixels on a canvas
 * `height` CSS pixels high, seen through a vertical field of view of `fov` degrees. three.js
 * multiplies such a sprite's scale by its distance, so its height on screen is the scale times the
 * projection's vertical factor, in units of half the canvas.
 */
export function threeScreenScale(pixels: number, height: number, fov: number): number {
	const vertical = 1 / Math.tan((fov * Math.PI) / 360);
	return (pixels * 2) / (vertical * height);
}

/** The object count that each engine's page reports: the boxes and the sprites. */
export const SPRITE_COUNT = SPRITE_BOXES.length + WORLD_SPRITES.length + SCREEN_SPRITES.length;
