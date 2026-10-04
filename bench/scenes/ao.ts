// Ambient occlusion's scene, defined once for null3D's image tests and for its three.js twin, which
// the parity test compares them with. It is plain data with no engine imports: a floor and a back
// wall that meet in a crease, with boxes and spheres that rest on the floor and against the wall.
// Ambient light alone lights it. null3D's ambient occlusion darkens only the ambient light, and
// three.js's GTAOPass the whole image, so with no other light both darken the same light.
import { PARITY_CANVAS } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const AO_IMAGE = PARITY_CANVAS;

/** The perspective camera: where it stands, the point it looks at, and its lens. */
export const AO_CAMERA = {
	position: [2.2, 2.4, 6.5],
	target: [0, 0.6, 0],
	fov: 50,
	near: 0.1,
	far: 50,
} as const satisfies { position: Vec3; target: Vec3; fov: number; near: number; far: number };

/** The sRGB background color. */
export const AO_BACKGROUND = '#1c2026';

/** The only light: white ambient light, bright enough to show the occlusion's shades. */
export const AO_AMBIENT = { color: '#ffffff', intensity: 2.5 } as const;

/**
 * A shape of the scene: a box of `size`, or a sphere whose radius is `size[0]`, at `position`, with
 * the standard material's sRGB color.
 */
export interface AoShape {
	kind: 'box' | 'sphere';
	size: Vec3;
	position: Vec3;
	color: string;
}

/** The floor and the wall, a stack of boxes in the corner, and spheres on the floor. */
export const AO_SHAPES: readonly AoShape[] = [
	{ kind: 'box', size: [8, 0.2, 6], position: [0, -0.1, 0], color: '#c8c4bc' },
	{ kind: 'box', size: [8, 4, 0.2], position: [0, 2, -2], color: '#b8c0c8' },
	{ kind: 'box', size: [1.2, 1.2, 1.2], position: [-1.8, 0.6, -1.3], color: '#d0a080' },
	{ kind: 'box', size: [0.7, 0.7, 0.7], position: [-1.6, 1.55, -1.4], color: '#a0c090' },
	{ kind: 'box', size: [0.5, 1.6, 0.5], position: [1.9, 0.8, -1.6], color: '#9098c8' },
	{ kind: 'sphere', size: [0.6, 0, 0], position: [0.1, 0.6, -0.6], color: '#e0d8d0' },
	{ kind: 'sphere', size: [0.35, 0, 0], position: [1.1, 0.35, 0.4], color: '#d8c090' },
	{ kind: 'sphere', size: [0.25, 0, 0], position: [-0.7, 0.25, 0.7], color: '#c0d0e0' },
];

/** Each ambient occlusion that the tests draw, by name, with three.js's `GTAOPass` meanings. */
export const AO_SETTINGS = {
	// GTAOPass's defaults.
	default: { radius: 0.25, thickness: 1, distanceExponent: 1, distanceFalloff: 1, scale: 1 },
	// A wider search, gathered toward the surface, and darker.
	wide: { radius: 0.8, thickness: 1, distanceExponent: 2, distanceFalloff: 1, scale: 1.5 },
} as const;

export type AoName = keyof typeof AO_SETTINGS;
