// The outline's scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports: a sphere half behind a
// wall, so its outline has a visible part and a hidden part, a box in the open, and a box without an
// outline, on a ground under a sun.
import { PARITY_CANVAS } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const OUTLINE_IMAGE = PARITY_CANVAS;

/** The perspective camera: where it stands, the point it looks at, and its lens. */
export const OUTLINE_CAMERA = {
	position: [0, 2.2, 8],
	target: [0, 0.4, 0],
	fov: 50,
	near: 0.1,
	far: 100,
} as const satisfies { position: Vec3; target: Vec3; fov: number; near: number; far: number };

/** The sRGB background color: a dark blue gray, on which both edge colors show. */
export const OUTLINE_BACKGROUND = '#202830';

/** A sun from the front left, and an ambient light that keeps the shadowed faces readable. */
export const OUTLINE_SUN = { direction: [-1, -2, -1.5], color: '#ffffff', intensity: 2 } as const;
export const OUTLINE_AMBIENT = { color: '#ffffff', intensity: 0.4 } as const;

/**
 * A shape of the scene: a box of `size`, or a sphere whose radius is `size[0]`, at `position`, with
 * the standard material's sRGB color, and whether it takes the outline.
 */
export interface OutlineShape {
	kind: 'box' | 'sphere';
	size: Vec3;
	position: Vec3;
	color: string;
	outlined: boolean;
}

/**
 * The ground, the wall, the sphere half behind it, the box in the open and the plain box. The box
 * in the open floats a little above the ground. Where it rests on the ground, three.js's mask
 * marks its lowest rows as hidden, because the depth that OutlinePass packs into a half float
 * target loses precision, and the parity test would measure that fault.
 */
export const OUTLINE_SHAPES: readonly OutlineShape[] = [
	{ kind: 'box', size: [12, 0.2, 6], position: [0, -0.6, 0], color: '#6a6e74', outlined: false },
	{ kind: 'box', size: [1.4, 2, 0.3], position: [-1.3, 0.5, 1], color: '#a07850', outlined: false },
	{
		kind: 'sphere',
		size: [0.8, 0, 0],
		position: [-2, 0.3, -0.4],
		color: '#5080c0',
		outlined: true,
	},
	{ kind: 'box', size: [1, 1, 1], position: [1, 0.1, 0], color: '#c05050', outlined: true },
	{
		kind: 'box',
		size: [0.8, 1.4, 0.8],
		position: [2.8, 0.2, -0.5],
		color: '#60a060',
		outlined: false,
	},
];

/** Each outline that the tests draw, by name, with three.js's `OutlinePass` meanings. */
export const OUTLINE_SETTINGS = {
	// three.js's defaults: white edges, dark brown hidden edges, a strength of 3 and a thickness of 1.
	plain: { color: '#ffffff', hiddenColor: [0.1, 0.04, 0.02], strength: 3, thickness: 1, glow: 0 },
	glow: { color: '#ffaa00', hiddenColor: '#3070ff', strength: 4, thickness: 2.5, glow: 1.5 },
} as const;

export type OutlineName = keyof typeof OUTLINE_SETTINGS;
