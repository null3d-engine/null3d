// The lines' scenes, defined once for null3D's image tests and for their three.js twins, which the
// parity test compares them with. They are plain data with no engine imports.
//
// The wide scene holds lines of several widths in front of a wall and over a floor: a zigzag whose
// sharp corners show the round joins, a helix with a color at each point, pairs of points as
// separate segments, a dashed wave, a loop whose width is in world units, and a blended line over
// the others. three.js draws each as a `Line2` or `LineSegments2` with a `LineMaterial`.
//
// The basic scene holds the same kinds of line one pixel wide, which three.js draws as `Line`,
// `LineSegments` and `LineLoop` with a `LineBasicMaterial`, and a dashed line with a
// `LineDashedMaterial`.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const LINE_IMAGE = PARITY_CANVAS;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const LINE_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 100,
	position: [0, 1.8, 6],
	target: [0, 1, 0],
} as const;

/** A box: its size along x, y and z, its center and its sRGB color, lit by the scene's lights. */
export interface LineBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

/** The floor and the wall behind the lines. */
export const LINE_BOXES: readonly LineBox[] = [
	{ size: [10, 0.2, 8], position: [0, -0.1, 0], color: '#8a8f99' },
	{ size: [8, 4, 0.3], position: [0, 2, -2], color: '#2c3e5c' },
];

/** Which points each segment joins, as null3D names the modes. */
export type LineSpecMode = 'segments' | 'strip' | 'loop';

/** The dashes of a dashed line: three.js's dash size, gap size and dash scale. */
export interface LineDashes {
	dashSize: number;
	gapSize: number;
	dashScale: number;
}

/** One line: its points, 3 numbers each, and how it looks. */
export interface LineSpec {
	mode: LineSpecMode;
	points: readonly number[];
	/** The sRGB color of the material. */
	color: string;
	/** An sRGB color for each point, which multiplies the material's color. */
	pointColors?: readonly string[];
	/** CSS pixels, or world units with `worldUnits`. */
	width: number;
	worldUnits?: boolean;
	dashes?: LineDashes;
	/** Below 1 for a blended line. */
	opacity?: number;
}

/** The points of a helix about the y axis: `turns` turns from `bottom` to `top`. */
function helix(center: Vec3, radius: number, bottom: number, top: number, turns: number): number[] {
	const points: number[] = [];
	const count = 48;
	for (let k = 0; k < count; k++) {
		const t = k / (count - 1);
		const angle = t * turns * 2 * Math.PI;
		points.push(
			center[0] + radius * Math.cos(angle),
			bottom + (top - bottom) * t,
			center[2] + radius * Math.sin(angle),
		);
	}
	return points;
}

/** An sRGB color of a hue from 0 to 1, at full saturation and half lightness, as a hex string. */
function hue(h: number): string {
	const channel = (n: number) => {
		const k = (n + h * 12) % 12;
		const value = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const HELIX = helix([0, 0, 0], 0.7, 0.3, 2.3, 2.5);

/** A wave along x at height `y` and depth `z`. */
function wave(y: number, z: number): number[] {
	const points: number[] = [];
	for (let k = 0; k <= 32; k++) {
		const x = -2.6 + (5.2 * k) / 32;
		points.push(x, y + 0.25 * Math.sin(x * 2.4), z);
	}
	return points;
}

/** The lines of the wide scene. */
export const WIDE_LINES: readonly LineSpec[] = [
	{
		mode: 'strip',
		points: [-3, 0.4, 0.6, -2.6, 1.6, 0.6, -2.2, 0.5, 0.4, -1.7, 1.7, 0.2, -1.4, 0.6, 0.6],
		color: '#ff9a3c',
		width: 12,
	},
	{
		mode: 'strip',
		points: HELIX,
		color: '#ffffff',
		pointColors: HELIX.filter((_, k) => k % 3 === 0).map((_, k, all) => hue(k / all.length)),
		width: 5,
	},
	{
		mode: 'segments',
		points: [
			1.4, 0.4, 0.5, 2.6, 0.4, 0.5, 1.4, 0.4, 0.5, 1.4, 1.6, 0.5, 1.4, 1.6, 0.5, 2.6, 0.4, 0.5, 2.0,
			1.8, 0, 2.0, 2.6, -0.8,
		],
		color: '#e6e6e6',
		width: 3,
	},
	{
		mode: 'strip',
		points: wave(2.9, -1),
		color: '#3dd6d0',
		width: 4,
		dashes: { dashSize: 0.25, gapSize: 0.12, dashScale: 1 },
	},
	{
		mode: 'loop',
		points: [-1.5, 0.05, 2, 1.5, 0.05, 2, 1.8, 0.05, 0.6, -0.4, 0.05, -0.6, -1.8, 0.05, 0.6],
		color: '#e05cff',
		width: 0.12,
		worldUnits: true,
	},
	{
		mode: 'segments',
		points: [-2.4, 2.4, 1, 2.4, 0.2, 1, -2.4, 0.6, 1.2, 2.4, 2.6, 1.2],
		color: '#ffe04a',
		width: 14,
		opacity: 0.5,
	},
];

/** The lines of the basic scene: the same kinds, one pixel wide. */
export const BASIC_LINES: readonly LineSpec[] = WIDE_LINES.filter(
	(line) => line.opacity === undefined,
).map((line) => ({ ...line, width: 1, worldUnits: false }));

/** The object count that each engine's page reports: the boxes and the lines. */
export const WIDE_LINE_COUNT = LINE_BOXES.length + WIDE_LINES.length;
export const BASIC_LINE_COUNT = LINE_BOXES.length + BASIC_LINES.length;

/** The points of a loop as three.js's strip draws it: the first point again at the end. */
export function closedLoop(points: readonly number[]): number[] {
	return [...points, points[0] ?? 0, points[1] ?? 0, points[2] ?? 0];
}
