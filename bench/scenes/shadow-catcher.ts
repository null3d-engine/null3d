// The shadow-catcher scene, defined once for null3D's image tests and for its three.js twin, which
// the parity test compares them with. A large ground lies under a low sun: a shadow-catcher
// material shows the sun's shadow on it in the material's color, and nothing where the light
// reaches it, so the background shows through. Boxes, a post and a ball cast the shadows.

type Vec3 = readonly [number, number, number];

/** The background, which the ground lets show where the light reaches it. */
export const SHADOW_CATCHER_BACKGROUND = '#cfd6df';
/** The ambient light, which lights the casters. */
export const SHADOW_CATCHER_AMBIENT = { color: '#ffffff', intensity: 0.4 } as const;

/** The image's size in pixels. */
export const SHADOW_CATCHER_IMAGE = { width: 480, height: 270 } as const;

/** The perspective camera: its field of view in degrees, where it stands and looks, and its planes. */
export const SHADOW_CATCHER_CAMERA = {
	fov: 50,
	position: [0, 5, 12],
	target: [0, 0, -4],
	near: 0.1,
	far: 300,
} as const satisfies { fov: number; position: Vec3; target: Vec3; near: number; far: number };

/** The sun: the way its light travels, its color and intensity, and its map and reach. */
export const SHADOW_CATCHER_SUN = {
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

/** The ground: a thin slab that receives the shadows, its size, its place, its color and opacity. */
export const SHADOW_CATCHER = {
	size: [120, 120] as const,
	position: [0, -0.1, -40] as const,
	color: '#000000',
	opacity: 0.6,
} as const satisfies {
	size: readonly [number, number];
	position: Vec3;
	color: string;
	opacity: number;
};

/** The casters: boxes and a ball on the ground near the camera, in the first cascade. */
export const SHADOW_CATCHER_CASTERS = [
	{ kind: 'box', size: [1.5, 1, 1.5], position: [1.5, 0.5, 4] },
	{ kind: 'box', size: [1, 1, 3], position: [-2.5, 0.5, 2] },
	{ kind: 'box', size: [0.4, 6, 0.4], position: [4, 3, -2] },
	{ kind: 'ball', radius: 0.9, position: [-1, 0.9, 5.5] },
] as const satisfies readonly (
	| { readonly kind: 'box'; readonly size: Vec3; readonly position: Vec3 }
	| { readonly kind: 'ball'; readonly radius: number; readonly position: Vec3 }
)[];

/** The count of objects that the report gives. */
export const SHADOW_CATCHER_COUNT = SHADOW_CATCHER_CASTERS.length + 1;

/**
 * three.js's shadow camera for the twin: a box along the light around the scene, which holds every
 * shadow that the view shows, in meters.
 */
export const THREE_SHADOW_CATCHER_CAMERA = { halfSize: 30 } as const;
