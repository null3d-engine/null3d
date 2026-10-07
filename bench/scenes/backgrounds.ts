// The backgrounds' scenes, defined once for null3D's image tests and for their three.js twin, which
// the parity test compares them with. It is plain data with no engine imports:
//
// - `sky`: three.js's Sky with the settings of its sky example, the sun low over the horizon and
//   clouds, behind an unlit box.
// - `environment`: an HDR file's environment as a blurred, dimmed and turned background, behind two
//   spheres that the same environment lights, as three.js's `backgroundBlurriness`,
//   `backgroundIntensity` and `backgroundRotation` show it.
// - `cubemap`: a cube map of six small pictures, as three.js's CubeTextureLoader loads them, seen
//   toward a corner of the cube so that three faces show.

import { sampleUrl } from '../../tools/lib/sample-url';
import { PARITY_CANVAS } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const BACKGROUNDS_IMAGE = PARITY_CANVAS;

/** The scenes, as the `bg` switch of the sketch and the twin names them. */
export const BACKGROUND_SCENES = ['sky', 'environment', 'cubemap'] as const;
export type BackgroundScene = (typeof BACKGROUND_SCENES)[number];

/** A perspective camera: its field of view in degrees, its planes, and where it stands and looks. */
export interface BackgroundCamera {
	fov: number;
	near: number;
	far: number;
	position: Vec3;
	target: Vec3;
}

/** The sun's place for three.js's sky: its elevation above the horizon and its azimuth, in degrees. */
const SUN_ELEVATION = 4;
const SUN_AZIMUTH = 180;

/**
 * A point toward the sun at an elevation and an azimuth, as three.js's sky example places it with
 * `Vector3.setFromSphericalCoords(1, phi, theta)`.
 */
function sunPosition(elevation: number, azimuth: number): Vec3 {
	const phi = ((90 - elevation) * Math.PI) / 180;
	const theta = (azimuth * Math.PI) / 180;
	return [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)];
}

/**
 * The sky's settings: three.js's sky example, with clouds at its default cover. The clouds stand
 * still: three.js's SkyMesh moves them by the renderer's own clock, which no twin can set.
 */
export const SKY = {
	sunPosition: sunPosition(SUN_ELEVATION, SUN_AZIMUTH),
	turbidity: 10,
	rayleigh: 3,
	mieCoefficient: 0.005,
	mieDirectionalG: 0.7,
	cloudCoverage: 0.4,
	cloudDensity: 0.4,
	cloudElevation: 0.5,
	cloudSpeed: 0,
} as const;

/** The sky's camera: at the origin, looking toward the sun and a little up, at the clouds. */
export const SKY_CAMERA: BackgroundCamera = {
	fov: 60,
	near: 0.1,
	far: 100,
	position: [0, 0, 0],
	target: [0, 0.25, -1],
};

/** The unlit box in front of the sky: its size, its center and its sRGB color. */
export const SKY_BOX = { size: 1, position: [1.6, -0.6, -4], color: '#3a6ea5' } as const;

/** The HDR file of the environment, which the asset tool turns into an environment map. */
export const BACKGROUND_HDR = sampleUrl(
	'sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr',
);

/** The environment background's options, in three.js's terms and units. */
export const ENVIRONMENT_BACKGROUND = {
	blur: 0.3,
	intensity: 0.7,
	rotation: [0, Math.PI / 2, 0],
} as const satisfies { blur: number; intensity: number; rotation: Vec3 };

/** The environment's camera. */
export const ENVIRONMENT_CAMERA: BackgroundCamera = {
	fov: 50,
	near: 0.1,
	far: 50,
	position: [0, 0.6, 5],
	target: [0, 0.3, 0],
};

/** The spheres that the environment lights: their centers, metalness and roughness. */
export const ENVIRONMENT_SPHERES = [
	{ position: [-0.9, 0, 0], metalness: 1, roughness: 0.15 },
	{ position: [0.9, 0, 0], metalness: 0, roughness: 0.6 },
] as const satisfies readonly { position: Vec3; metalness: number; roughness: number }[];

/** The spheres' radius and segments, and their sRGB color. */
export const ENVIRONMENT_SPHERE = { radius: 0.75, widthSegments: 48, heightSegments: 24 } as const;
export const ENVIRONMENT_COLOR = '#e8e0d0';

/**
 * The cube map's faces, toward +X, -X, +Y, -Y, +Z and -Z in that order: rows of sRGB colors, top
 * row first, one color per pixel. Each face has a color of its own, with a white pixel in its top
 * left corner and a black one in its bottom right corner, so a face that is turned or mirrored
 * shows.
 */
export const CUBEMAP_FACES: readonly (readonly (readonly string[])[])[] = [
	'#d04040',
	'#40a0a0',
	'#40b040',
	'#a040a0',
	'#4060d0',
	'#d0a030',
].map((color) => [
	['#ffffff', color, color, color],
	[color, color, '#202020', color],
	[color, color, color, color],
	[color, color, color, '#000000'],
]);

/** The cube map's camera: at the origin, looking toward a corner of the cube. */
export const CUBEMAP_CAMERA: BackgroundCamera = {
	fov: 90,
	near: 0.1,
	far: 50,
	position: [0, 0, 0],
	target: [1, 0.55, 0.8],
};
