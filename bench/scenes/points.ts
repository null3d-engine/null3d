// The points' scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports. Four clouds stand in
// front of a lit wall: opaque squares sized in world units at several depths, cut-out discs of a
// map, see-through discs, and squares sized in pixels near the floor. No two points of one cloud
// overlap, as three.js draws a cloud's points in their order and null3D sorts blended points. three.js
// draws each cloud as one `Points` with a `PointsMaterial`.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const POINT_IMAGE = PARITY_CANVAS;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const POINT_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 100,
	position: [0, 1.8, 7],
	target: [0, 1, 0],
} as const;

/** A box: its size along x, y and z, its center and its sRGB color, lit by the scene's lights. */
export interface PointBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

/** The floor and the wall behind the points. */
export const POINT_BOXES: readonly PointBox[] = [
	{ size: [12, 0.2, 8], position: [0, -0.1, 0], color: '#8a8f99' },
	{ size: [10, 5, 0.3], position: [0, 2.3, -2.5], color: '#4a8cff' },
];

/** The sRGB colors that the clouds' points take in turn. */
const PALETTE = ['#e8554e', '#f2c14e', '#5bc27a', '#fafafa', '#b06ce0', '#ff8a3d', '#3dd6d0'];

/** A cloud: its points, an sRGB color for each, and how the points draw. */
export interface PointCloud {
	positions: readonly Vec3[];
	colors: readonly string[];
	/** World units, or CSS pixels when `pixels` is true. */
	size: number;
	/** True for sizes in CSS pixels: no size attenuation. */
	pixels: boolean;
	/** `opaque`, `mask` (a cut-out at alpha 0.5) or `blend`. */
	alphaMode: 'opaque' | 'mask' | 'blend';
	/** True when the points show the disc picture. */
	map: boolean;
	/** The opacity of every point. */
	opacity: number;
}

/** The points of a grid `columns` across and `rows` up, from `start`, `step` apart, each at its own depth. */
function grid(
	columns: number,
	rows: number,
	start: Vec3,
	step: readonly [number, number],
	depth: (k: number) => number,
): Vec3[] {
	const points: Vec3[] = [];
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < columns; x++)
			points.push([
				start[0] + x * step[0],
				start[1] + y * step[1],
				start[2] + depth(points.length),
			]);
	return points;
}

/** The colors of `count` points, from the palette in turn. */
const colorsOf = (count: number, from = 0) =>
	Array.from({ length: count }, (_, k) => PALETTE[(k + from) % PALETTE.length] ?? '#ffffff');

const squares = grid(8, 3, [-3.5, 1.4, 0], [1, 0.7], (k) => ((k * 5) % 7) * 0.4 - 1.2);
const cutOuts = grid(5, 1, [-3, 0.6, 1.2], [1.5, 0], (k) => (k % 2) * 0.6);
const seeThrough = grid(4, 1, [-2.25, 3.6, -1.2], [1.5, 0], () => 0);
const onScreen = grid(9, 1, [-3.2, 0.15, 2.2], [0.8, 0], (k) => (k % 3) * 0.3);

/** The clouds, in the order that both engines create them. */
export const POINT_CLOUDS: readonly PointCloud[] = [
	{
		positions: squares,
		colors: colorsOf(squares.length),
		size: 0.25,
		pixels: false,
		alphaMode: 'opaque',
		map: false,
		opacity: 1,
	},
	{
		positions: cutOuts,
		colors: colorsOf(cutOuts.length, 2),
		size: 0.6,
		pixels: false,
		alphaMode: 'mask',
		map: true,
		opacity: 1,
	},
	{
		positions: seeThrough,
		colors: colorsOf(seeThrough.length, 4),
		size: 0.9,
		pixels: false,
		alphaMode: 'blend',
		map: true,
		opacity: 0.6,
	},
	{
		positions: onScreen,
		colors: colorsOf(onScreen.length, 1),
		size: 12,
		pixels: true,
		alphaMode: 'opaque',
		map: false,
		opacity: 1,
	},
];

/** The disc picture's side in pixels. */
const DISC_SIDE = 16;

/**
 * The disc picture as rows of CSS colors, top row first, one color per pixel: a white disc on a
 * clear ground, with a dark bar above its middle that shows which way is up.
 */
export function discRows(): string[][] {
	const rows: string[][] = [];
	for (let y = 0; y < DISC_SIDE; y++) {
		const row: string[] = [];
		for (let x = 0; x < DISC_SIDE; x++) {
			const [u, v] = [x - DISC_SIDE / 2 + 0.5, y - DISC_SIDE / 2 + 0.5];
			const bar = Math.abs(u) < 1.5 && v > -6 && v < -2.5;
			row.push(bar ? '#202020' : u * u + v * v < 49 ? '#ffffff' : 'rgba(0, 0, 0, 0)');
		}
		rows.push(row);
	}
	return rows;
}

/**
 * The `size` of a three.js `PointsMaterial` with size attenuation that draws a point `worldSize`
 * units wide, as null3D's points are, through a vertical field of view of `fov` degrees. three.js
 * scales such a point by half the canvas's height over its depth, which leaves out the projection's
 * own scale: one over the tangent of half the field of view.
 */
export function threePointSize(worldSize: number, fov: number): number {
	return worldSize / Math.tan((fov * Math.PI) / 360);
}

/** The object count that each engine's page reports: the boxes and the clouds. */
export const POINT_COUNT = POINT_BOXES.length + POINT_CLOUDS.length;
