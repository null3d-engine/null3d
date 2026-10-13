// The shadow-catcher scene, defined once for null3D's image tests and for its three.js twin, which
// the parity test compares them with. A plane with a shadow-catcher material lies flat: it shows the
// main directional light's shadow where it falls, in the material's color, and nothing where the
// light reaches it, so the background shows through. Boxes, a post and a ball above the plane cast
// the shadows. The sun is low, so the shadows are long.

type Vec3 = readonly [number, number, number];

/** The background, which the plane lets show where the light reaches it. */
export const SHADOW_CATCHER_BACKGROUND = '#cfd6df';
/** The ambient light, which lights the casters. */
export const SHADOW_CATCHER_AMBIENT = { color: '#ffffff', intensity: 0.35 } as const;

/** The image's size in pixels. */
export const SHADOW_CATCHER_IMAGE = { width: 480, height: 270 } as const;

/** The perspective camera: its field of view in degrees, where it stands and looks, and its planes. */
export const SHADOW_CATCHER_CAMERA = {
	fov: 45,
	position: [4.2, 4.2, 6.4],
	target: [0, 0.2, -0.4],
	near: 0.1,
	far: 200,
} as const satisfies { fov: number; position: Vec3; target: Vec3; near: number; far: number };

/** The sun: the way its light travels, its color and intensity, and its map and reach. */
export const SHADOW_CATCHER_SUN = {
	direction: [-0.6, -1, -0.35],
	color: '#fff4e2',
	intensity: 3,
	mapSize: 1024,
	distance: 40,
} as const satisfies {
	direction: Vec3;
	color: string;
	intensity: number;
	mapSize: number;
	distance: number;
};

/** The catcher plane: its size, its place, the color of the shadow it shows, and its opacity. */
export const SHADOW_CATCHER = {
	size: [30, 30],
	position: [0, 0, 0],
	color: '#000000',
	opacity: 0.6,
} as const satisfies {
	size: readonly [number, number];
	position: Vec3;
	color: string;
	opacity: number;
};

/** A caster: a box by its size, or a ball by its radius, at a center. */
export type ShadowCaster =
	| { readonly kind: 'box'; readonly size: Vec3; readonly position: Vec3 }
	| { readonly kind: 'ball'; readonly radius: number; readonly position: Vec3 };

/** The casters, from the left of the plane to its front. */
export const SHADOW_CATCHER_CASTERS: readonly ShadowCaster[] = [
	{ kind: 'box', size: [1.4, 1.4, 1.4], position: [-1.6, 0.7, 0.2] },
	{ kind: 'box', size: [2.4, 0.4, 1.2], position: [-0.2, 0.2, -2.6] },
	{ kind: 'box', size: [0.5, 3, 0.5], position: [1.4, 1.5, -1.2] },
	{ kind: 'ball', radius: 0.9, position: [0.2, 0.9, 1.6] },
];

/** The count of objects that the report gives. */
export const SHADOW_CATCHER_COUNT = SHADOW_CATCHER_CASTERS.length + 1;

/**
 * three.js's shadow camera for the twin: a box along the light around the plane, which holds every
 * shadow that the view shows, in meters.
 */
export const THREE_SHADOW_CATCHER_CAMERA = { halfSize: 20 } as const;
