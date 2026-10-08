// The masked materials' scene, defined once for null3D's image tests and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports. Square cards
// carry rings of vertex alpha, and each masked material cuts them at its own cutoff, so each card
// shows rings of another width. The cards stand in front of a wall and cross each other, and a
// batch of small cards lies tilted on the floor. MSAA smooths the cards' outer edges, and the cut
// edges stay as the cutoff draws them, unless the cards turn alpha to coverage on. The same cards
// with the alpha hash draw a share of each ring that their alpha sets.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const MASK_IMAGE = PARITY_CANVAS;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const MASK_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 100,
	position: [0, 2.2, 7],
	target: [0, 1.1, 0],
} as const;

/** A box: its size along x, y and z, its center and its sRGB color, lit by the scene's lights. */
export interface MaskBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

/** The floor and the wall behind the cards. */
export const MASK_BOXES: readonly MaskBox[] = [
	{ size: [12, 0.2, 8], position: [0, -0.1, 0], color: '#8a8f99' },
	{ size: [8, 4, 0.3], position: [0, 2, -1.8], color: '#4a8cff' },
];

/**
 * A card: whether lights shade it, its alpha cutoff, its center, and its rotation as Euler angles
 * in radians in three.js's XYZ order.
 */
export interface MaskCard {
	lit: boolean;
	cutoff: number;
	position: Vec3;
	rotation: Vec3;
}

/** The standing cards. The middle one crosses the right one. */
export const MASK_CARDS: readonly MaskCard[] = [
	{ lit: true, cutoff: 0.5, position: [-2, 1.3, 0], rotation: [0, 0.35, 0] },
	{ lit: false, cutoff: 0.3, position: [0, 1.4, 0.3], rotation: [-0.2, -0.5, 0.1] },
	{ lit: true, cutoff: 0.75, position: [1.3, 1.2, -0.2], rotation: [0.1, 0.6, 0] },
];

/** The edge of a card, and the cells along each edge of its grid of vertices. */
export const CARD_SIZE = 2;
const CARD_CELLS = 16;

/** The batch's small cards: their edge, cutoff and centers, all tipped back by one angle. */
export const MASK_TILE = {
	scale: 0.35,
	cutoff: 0.5,
	tilt: -1.1,
	positions: [
		[-2.4, 0.4, 2],
		[-0.8, 0.4, 2.2],
		[0.8, 0.4, 2.2],
		[2.4, 0.4, 2],
	] as readonly Vec3[],
} as const;

/** The quaternion (x, y, z, w) of a turn of `angle` radians about the x axis. */
export function turnAboutX(angle: number): [number, number, number, number] {
	return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

/**
 * The mesh of a card: positions, normals, texture coordinates from 0 at the bottom left to 1 at the
 * top right, linear colors with alpha, and triangle indices.
 */
export interface CardMesh {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	colors: Float32Array;
	indices: Uint16Array;
}

/**
 * A card of `CARD_SIZE` in the xy plane, facing +z, as a grid of vertices. Each vertex's alpha
 * rises and falls in rings around the center, and its color runs from orange at the left to
 * purple at the right, brighter at the top.
 */
export function cardMesh(): CardMesh {
	const side = CARD_CELLS + 1;
	const positions = new Float32Array(side * side * 3);
	const normals = new Float32Array(side * side * 3);
	const uvs = new Float32Array(side * side * 2);
	const colors = new Float32Array(side * side * 4);
	for (let row = 0; row < side; row++) {
		for (let column = 0; column < side; column++) {
			const u = column / CARD_CELLS;
			const v = row / CARD_CELLS;
			const x = (u - 0.5) * CARD_SIZE;
			const y = (v - 0.5) * CARD_SIZE;
			const k = row * side + column;
			positions.set([x, y, 0], k * 3);
			normals.set([0, 0, 1], k * 3);
			uvs.set([u, v], k * 2);
			const radius = Math.sqrt(x * x + y * y) / (CARD_SIZE / 2);
			const alpha = 0.5 + 0.5 * Math.cos(radius * 3 * Math.PI);
			colors.set([0.9 - 0.5 * u, 0.25 + 0.5 * v, 0.1 + 0.8 * u, alpha], k * 4);
		}
	}
	const indices = new Uint16Array(CARD_CELLS * CARD_CELLS * 6);
	let at = 0;
	for (let row = 0; row < CARD_CELLS; row++) {
		for (let column = 0; column < CARD_CELLS; column++) {
			const a = row * side + column;
			const b = a + 1;
			const c = a + side;
			const d = c + 1;
			indices.set([a, b, d, a, d, c], at);
			at += 6;
		}
	}
	return { positions, normals, uvs, colors, indices };
}

/**
 * How the cards test their alpha: the plain mask, as three.js's `alphaTest`; alpha to coverage,
 * which smooths the cut edges with MSAA, as `alphaToCoverage` with `alphaTest`; or the alpha hash,
 * as `alphaHash`, which ignores the cutoff.
 */
export const MASK_MODES = ['mask', 'coverage', 'hash'] as const;
export type MaskMode = (typeof MASK_MODES)[number];

/**
 * The sun's shadows of the shadow variant, where the cards cast the holes of their masks onto the
 * floor and the wall. null3D draws them in its cascades to `distance`, with `mapSize` texels on
 * each side. three.js draws one map of `threeMapSize` texels, in a box of `halfSize` on each side
 * of the light's line through the origin, which holds every shadow the view shows.
 */
export const MASK_SHADOWS = {
	cascades: 1,
	mapSize: 2048,
	distance: 14,
	halfSize: 7,
	threeMapSize: 2048,
} as const;

/**
 * The cards of the shadow variant whose base color map cuts their shape: a lit one and an unlit
 * one, each with the map's stripes, at the cutoff `cutoff`.
 */
export const MASK_MAP_CARDS: readonly MaskCard[] = [
	{ lit: true, cutoff: 0.5, position: [-3.4, 1.2, 0.8], rotation: [0, 0.5, 0] },
	{ lit: false, cutoff: 0.5, position: [3.3, 1.1, 0.9], rotation: [0, -0.5, 0] },
];

/** The texels on each side of the cards' map. */
export const STRIPE_SIZE = 16;

/**
 * The sRGB texels of the cards' map: diagonal stripes, opaque and clear in turn, in two greens, four
 * bytes per texel, rows from the bottom.
 */
export function stripeTexels(): Uint8Array {
	const texels = new Uint8Array(STRIPE_SIZE * STRIPE_SIZE * 4);
	for (let y = 0; y < STRIPE_SIZE; y++)
		for (let x = 0; x < STRIPE_SIZE; x++) {
			const opaque = (x + y) % 6 < 3;
			texels.set([60, 150 + (x % 2) * 60, 70, opaque ? 255 : 0], (y * STRIPE_SIZE + x) * 4);
		}
	return texels;
}

/** The object count that each engine's page reports: the boxes, the cards and the tiles. */
export const MASK_COUNT = MASK_BOXES.length + MASK_CARDS.length + MASK_TILE.positions.length;
