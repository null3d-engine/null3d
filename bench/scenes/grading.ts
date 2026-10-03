// Color grading's scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports: a row of boxes in seven
// hues over a row of grays from black to white, on a light ground, so a table's change of each
// hue and of the tones shows, and a vignette darkens the corners.
import { sampleUrl } from '../../tools/lib/sample-url';
import { PARITY_CANVAS } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const GRADING_IMAGE = PARITY_CANVAS;

/** The perspective camera: where it stands, the point it looks at, and its lens. */
export const GRADING_CAMERA = {
	position: [0, 1.6, 9],
	target: [0, 0.4, 0],
	fov: 45,
	near: 0.1,
	far: 100,
} as const satisfies { position: Vec3; target: Vec3; fov: number; near: number; far: number };

/** The sRGB background color: a pale sky, which the vignette darkens at the corners. */
export const GRADING_BACKGROUND = '#a8c0d8';

/** A sun from the front left, and an ambient light that keeps the shadowed faces readable. */
export const GRADING_SUN = { direction: [-1, -1.5, -2], color: '#ffffff', intensity: 2.5 } as const;
export const GRADING_AMBIENT = { color: '#ffffff', intensity: 0.6 } as const;

/** A box of the scene: its size, its place and its sRGB color, with the standard material. */
export interface GradingBox {
	size: Vec3;
	position: Vec3;
	color: string;
}

const HUES = ['#e03030', '#e08020', '#e0d030', '#40b040', '#30b0c0', '#3050d0', '#b040c0'];
const GRAYS = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'];

/** The ground, the hues and the grays. */
export const GRADING_BOXES: readonly GradingBox[] = [
	{ size: [14, 0.2, 6], position: [0, -0.7, 0], color: '#b0aca4' },
	...HUES.map(
		(color, k): GradingBox => ({
			size: [0.8, 0.8, 0.8],
			position: [(k - 3) * 1.05, 1.1, 0],
			color,
		}),
	),
	...GRAYS.map(
		(color, k): GradingBox => ({
			size: [1, 0.8, 0.8],
			position: [(k - 2) * 1.3, -0.1, 0],
			color,
		}),
	),
];

/** The color grading tables that the tests load, by name: a warm one and a cool one. */
export const GRADING_LUTS = {
	warm: sampleUrl('sources/luts/warm.cube'),
	cool: sampleUrl('sources/luts/cool.3dl'),
} as const;

export type GradingLutName = keyof typeof GRADING_LUTS;

/** The vignette that the tests draw, with three.js's `VignetteShader` meanings. */
export const GRADING_VIGNETTE = { offset: 1.2, darkness: 1.1 } as const;

/** The table's intensity in the tests that draw it with the vignette. */
export const GRADING_INTENSITY = 0.7;
