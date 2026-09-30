// The directional light's shadows, defined once for null3D's image tests and for its three.js twin,
// which the parity test compares them with. It is plain data with no engine imports: a ground that
// receives shadows, and boxes, a ball and tall posts that cast and receive them, from next to the
// camera out past 40 m, so each of up to four cascades holds some. The sun shines low across the
// scene, so the shadows are long. A box on the left receives shadows but casts none, a post on the
// right casts but receives none, and an unlit box shows no shadow on itself.

export { AMBIENT, BACKGROUND } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels. */
export const SHADOW_IMAGE = { width: 480, height: 270 } as const;

/** The perspective camera: its field of view in degrees, where it stands and looks, and its planes. */
export const SHADOW_CAMERA = {
	fov: 50,
	position: [0, 5, 12],
	target: [0, 0, -4],
	near: 0.1,
	far: 300,
} as const satisfies { fov: number; position: Vec3; target: Vec3; near: number; far: number };

/** The sun: the way its light travels, its color and intensity, and its shadows' map and reach. */
export const SHADOW_SUN = {
	direction: [-1, -1.1, -0.6],
	color: '#ffffff',
	intensity: 3,
	mapSize: 1024,
	distance: 60,
} as const satisfies {
	direction: Vec3;
	color: string;
	intensity: number;
	mapSize: number;
	distance: number;
};

/** The meshes: boxes by their size along x, y and z, and a ball by its radius. */
export const SHADOW_MESHES = {
	ground: { size: [120, 0.2, 120] },
	box: { size: [1, 1, 1] },
	post: { size: [0.4, 6, 0.4] },
	ball: { radius: 0.7 },
} as const satisfies Record<string, { size: Vec3 } | { radius: number }>;

export type ShadowMeshName = keyof typeof SHADOW_MESHES;

/**
 * An object: its mesh, its center, its sRGB color, whether lights shade it, and whether it casts
 * and receives shadows.
 */
export interface ShadowObject {
	mesh: ShadowMeshName;
	position: Vec3;
	color: string;
	lit: boolean;
	cast: boolean;
	receive: boolean;
}

const GROUND = '#9aa0a8';
const RED = '#e8554e';
const YELLOW = '#f2c14e';
const GREEN = '#5bc27a';
const BLUE = '#4a8cff';
const PURPLE = '#b06ce0';

/** A lit object that casts and receives shadows. */
const both = (mesh: ShadowMeshName, position: Vec3, color: string): ShadowObject => ({
	mesh,
	position,
	color,
	lit: true,
	cast: true,
	receive: true,
});

/** The ground, then the objects from near the camera to far from it. */
export const SHADOW_OBJECTS: readonly ShadowObject[] = [
	{
		mesh: 'ground',
		position: [0, -0.1, -40],
		color: GROUND,
		lit: true,
		cast: false,
		receive: true,
	},
	// Near the camera: in the first cascade.
	both('box', [1.5, 0.5, 4], RED),
	both('ball', [-1, 0.7, 5.5], YELLOW),
	// A box that receives shadows but casts none, beside the post that shades it.
	{ mesh: 'box', position: [-3.5, 0.5, 1], color: GREEN, lit: true, cast: false, receive: true },
	both('post', [-1.8, 3, 1.8], BLUE),
	// A post that casts but receives none, and an unlit box in its shadow.
	{ mesh: 'post', position: [4, 3, -2], color: BLUE, lit: true, cast: true, receive: false },
	{ mesh: 'box', position: [2.2, 0.5, -2.6], color: PURPLE, lit: false, cast: true, receive: true },
	// Farther out: in the later cascades.
	...Array.from({ length: 6 }, (_, k): ShadowObject[] => {
		const z = -8 - k * 7;
		const x = k % 2 === 0 ? -4 - k : 3 + k;
		return [both('post', [x, 3, z], BLUE), both('box', [x + 2, 0.5, z + 1], RED)];
	}).flat(),
];

/**
 * three.js's shadow camera for the twin: a box along the light around every shadow that the view
 * shows, from the point it looks at, its half width and height, and its depth, in meters. three.js
 * draws one shadow map in this box, where null3D fits its cascades to the view.
 */
export const THREE_SHADOW_CAMERA = {
	target: [0, 0, -22],
	halfSize: 38,
	depth: 160,
	mapSize: 4096,
} as const satisfies { target: Vec3; halfSize: number; depth: number; mapSize: number };
