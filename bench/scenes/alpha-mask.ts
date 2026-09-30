// The masked materials' scene, defined once for null3D's image tests and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports. Square cards
// carry rings of vertex alpha, and each masked material cuts them at its own cutoff, so each card
// shows rings of another width. The cards stand in front of a wall and cross each other, and a
// batch of small cards lies tilted on the floor. MSAA smooths the cards' outer edges, and the cut
// edges stay as the cutoff draws them.
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

/** The mesh of a card: positions, normals, linear colors with alpha, and triangle indices. */
export interface CardMesh {
	positions: Float32Array;
	normals: Float32Array;
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
	return { positions, normals, colors, indices };
}

/** The object count that each engine's page reports: the boxes, the cards and the tiles. */
export const MASK_COUNT = MASK_BOXES.length + MASK_CARDS.length + MASK_TILE.positions.length;
