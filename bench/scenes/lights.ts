// The point, spot and hemisphere light scenes, defined once for null3D's image tests and for their
// three.js twin, which the parity test compares them with. It is plain data with no engine imports:
// a floor with rows of spheres and boxes, lit by point lights in a square grid above it, by spot
// lights of different cones, or by a hemisphere light, and a dim ambient light. No directional
// light shines, so in the point and spot scenes every lit pixel comes from the clusters.

type Vec3 = readonly [number, number, number];

/** The image's size in pixels. */
export const LIGHTS_IMAGE = { width: 480, height: 270 } as const;

/**
 * The hemisphere light: a blue sky above and a brown ground below, which shade each surface by
 * how far its normal turns up or down.
 */
export const HEMISPHERE_LIGHT = {
	skyColor: '#9cc8ff',
	groundColor: '#806040',
	intensity: 1.5,
} as const;

/** The background, in sRGB. */
export const LIGHTS_BACKGROUND = '#101216';

/** The ambient light, dim so that the point and spot lights show. */
export const LIGHTS_AMBIENT = { color: '#ffffff', intensity: 0.05 } as const;

/** The perspective camera: its vertical field of view in degrees, its planes and its pose. */
export const LIGHTS_CAMERA = {
	fov: 50,
	near: 0.1,
	far: 100,
	position: [0, 9, 13],
	target: [0, 0, 1],
} as const satisfies { fov: number; near: number; far: number; position: Vec3; target: Vec3 };

/**
 * The orthographic camera: its pose, the height of its view in meters, and its planes. The view's
 * width follows the image's aspect ratio.
 */
export const LIGHTS_ORTHO_CAMERA = {
	position: [6, 12, 10],
	target: [0, 0, 0],
	height: 14,
	near: 1,
	far: 60,
} as const satisfies { position: Vec3; target: Vec3; height: number; near: number; far: number };

/** The segments of the spheres' mesh, around and from pole to pole. Their radius is 1, scaled. */
export const LIGHTS_SPHERE = { widthSegments: 32, heightSegments: 16 } as const;

/** The floor: a square plane at y = 0, with its edge in meters. */
export const LIGHTS_FLOOR = { size: 20, color: '#9a9ea8', roughness: 0.8 } as const;

/** A lit shape on the floor. */
export interface LitShape {
	shape: 'sphere' | 'box';
	/** The center. */
	position: Vec3;
	/** The sphere's radius, or the box's edge. */
	size: number;
	color: string;
	roughness: number;
	metalness: number;
}

/** A 5 by 5 grid of spheres and boxes in turn, 3 m apart, each standing on the floor. */
export const LIGHTS_SHAPES: readonly LitShape[] = Array.from({ length: 25 }, (_, k): LitShape => {
	const [column, row] = [k % 5, Math.floor(k / 5)];
	const sphere = k % 2 === 0;
	const size = sphere ? 0.5 : 0.9;
	return {
		shape: sphere ? 'sphere' : 'box',
		position: [(column - 2) * 3, sphere ? size : size / 2, (row - 2) * 3],
		size,
		color: ['#e0e0e0', '#c8b090', '#90a8c8'][k % 3] as string,
		roughness: [0.3, 0.6, 0.9][row % 3] as number,
		metalness: column === 4 ? 1 : 0,
	};
});

/** A point light: its position, sRGB color, intensity in candela, range and decay. */
export interface ScenePointLight {
	position: Vec3;
	color: string;
	intensity: number;
	range: number;
	decay: number;
}

/** The colors the grid of point lights takes in turn. */
const PALETTE = ['#ff5a4e', '#ffb84e', '#e8f25b', '#5bf28a', '#4ec8ff', '#9a6cff'];

/**
 * `count` point lights in a square grid over the floor: `count` is a square, such as 1, 16 or
 * 256. Denser grids hang lower, with shorter ranges and dimmer lights, so each grid lights the
 * floor about as brightly.
 */
export function pointLightGrid(count: number): ScenePointLight[] {
	const side = Math.round(Math.sqrt(count));
	if (side * side !== count) throw new Error(`${count} point lights do not make a square`);
	const spacing = 16 / side;
	const height = Math.min(3, Math.max(0.6, spacing * 0.45));
	const range = Math.min(14, spacing * 1.8);
	return Array.from({ length: count }, (_, k): ScenePointLight => {
		const [column, row] = [k % side, Math.floor(k / side)];
		return {
			position: [(column - (side - 1) / 2) * spacing, height, (row - (side - 1) / 2) * spacing],
			color: count === 1 ? '#ffffff' : (PALETTE[k % PALETTE.length] as string),
			intensity: 4 * height * height,
			range,
			decay: 2,
		};
	});
}

/** A spot light: a point light with a target, a cone and a penumbra. */
export interface SceneSpotLight extends ScenePointLight {
	target: Vec3;
	angle: number;
	penumbra: number;
}

/**
 * Three spot lights: a narrow sharp cone straight down, a wider cone with a soft edge aimed ahead,
 * and a wide cone whose whole width fades, with a slower decay, aimed across the floor.
 */
export const SPOT_LIGHTS: readonly SceneSpotLight[] = [
	{
		position: [-5, 6, -1],
		target: [-5, 0, -1],
		color: '#ffd8a0',
		intensity: 90,
		range: 12,
		decay: 2,
		angle: Math.PI / 10,
		penumbra: 0,
	},
	{
		position: [0, 5, -2],
		target: [0, 0, 2],
		color: '#a0d8ff',
		intensity: 70,
		range: 12,
		decay: 2,
		angle: Math.PI / 6,
		penumbra: 0.5,
	},
	{
		position: [6, 4, 3],
		target: [3, 0, -3],
		color: '#ff90c0',
		intensity: 8,
		range: 14,
		decay: 1,
		angle: Math.PI / 4,
		penumbra: 1,
	},
];
