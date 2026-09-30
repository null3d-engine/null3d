// The texture maps scene, defined once for null3D's image tests and for its three.js twin, which
// the parity test compares them with. It is plain data with no engine imports: each map of the
// standard material on its own sphere or quad, under the benchmark scenes' lights. Top row: a base
// color map, a metal-rough map in bands of smooth metal and rough paint, and a normal map on a
// quad without tangents and on one with them. Bottom row: an occlusion map, an emissive map, a
// light map on the second texture coordinates, and a base color map through a texture coordinate
// transform, on a standard and on an unlit material.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, SUN } from './spec';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const MAPS_IMAGE = PARITY_CANVAS;

/**
 * The clear color: a mid gray, close to the objects' own brightness. The two engines average the
 * samples of an anti-aliased edge a few levels apart, and more so against a dark background. The
 * image comparison ignores some anti-aliased pixels, but not those along the quads' straight edges.
 */
export const MAPS_BACKGROUND = '#60666e';

/** The perspective camera. */
export const MAPS_CAMERA = {
	fov: 35,
	near: 0.1,
	far: 50,
	position: [0, 0, 10],
	target: [0, 0, 0],
} as const satisfies { fov: number; near: number; far: number; position: Vec3; target: Vec3 };

/** Texels along each side of every map. */
export const MAP_SIZE = 32;

/** One map: its texels, as RGBA bytes at column x and row y, its color space and its UV set. */
export interface MapSpec {
	texel(x: number, y: number): readonly number[];
	colorSpace: 'srgb' | 'linear';
	uvSet: 0 | 1;
}

/** True on the dark squares of a 4 x 4 checkerboard. */
const checker = (x: number, y: number) => ((x >> 3) + (y >> 3)) % 2 === 0;

/** Ridges along u: a normal that leans with the slope of a sine, in tangent space. */
function ridge(x: number): number[] {
	const slope = Math.cos((x / MAP_SIZE) * Math.PI * 4) * 1.5;
	const length = Math.hypot(slope, 1);
	return [(-slope / length) * 127.5 + 127.5, 127.5, (1 / length) * 127.5 + 127.5, 255];
}

/** The scene's maps by name. */
export const MAPS = {
	checks: {
		texel: (x, y) => (checker(x, y) ? [200, 40, 40, 255] : [240, 240, 240, 255]),
		colorSpace: 'srgb',
		uvSet: 0,
	},
	stripes: {
		texel: (_, y) => ((y >> 3) % 2 === 0 ? [0, 60, 255, 255] : [0, 255, 0, 255]),
		colorSpace: 'linear',
		uvSet: 0,
	},
	ridges: { texel: ridge, colorSpace: 'linear', uvSet: 0 },
	shadow: {
		texel: (x, y) => (Math.hypot(x - 15.5, y - 15.5) < 9 ? [60, 0, 0, 255] : [255, 0, 0, 255]),
		colorSpace: 'linear',
		uvSet: 0,
	},
	glow: {
		texel: (x, y) => (checker(x, y) ? [255, 160, 40, 255] : [0, 0, 0, 255]),
		colorSpace: 'srgb',
		uvSet: 0,
	},
	baked: { texel: (x) => [x * 8, 40, 255 - x * 8, 255], colorSpace: 'srgb', uvSet: 1 },
} as const satisfies Record<string, MapSpec>;

export type MapName = keyof typeof MAPS;

/** The texels of a map, row 0 first, which both engines place at v = 0. */
export function mapTexels(spec: MapSpec): Uint8Array {
	const data = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
	for (let y = 0; y < MAP_SIZE; y++)
		for (let x = 0; x < MAP_SIZE; x++) data.set(spec.texel(x, y), (y * MAP_SIZE + x) * 4);
	return data;
}

/**
 * The meshes. A sphere and a quad of four by four cells come from each engine's generators. Each
 * square is two triangles from arrays: one with computed tangents, and one with a second set of
 * texture coordinates.
 */
export type MapsMesh = 'sphere' | 'quad' | 'tangent-square' | 'second-uv-square';

/** The sphere's radius and segments, and the quads' size and cells. */
export const MAPS_SPHERE = { radius: 0.7, widthSegments: 48, heightSegments: 24 } as const;
export const MAPS_QUAD = { width: 1.4, height: 1.4, widthSegments: 4, heightSegments: 4 } as const;

/** The square of two triangles, facing +z, with its texture coordinates. */
export const MAPS_SQUARE = {
	positions: [-0.7, -0.7, 0, 0.7, -0.7, 0, 0.7, 0.7, 0, -0.7, 0.7, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
} as const;

/** The second texture coordinates of the light map's square, which run the other way along u. */
export const MAPS_SQUARE_UVS1 = [1, 0, 0, 0, 0, 1, 1, 1] as const;

/** A texture coordinate transform, as three.js's texture offset, repeat and rotation give it. */
export interface MapsUvTransform {
	offset: Vec2;
	repeat: Vec2;
	rotation: number;
}

/** The transform of the two squares at the bottom right. */
const TRANSFORM: MapsUvTransform = { offset: [0.25, 0], repeat: [3, 2], rotation: 0.3 };

/** One object: its mesh, its material, where it stands, and its turn about x in radians. */
export interface MapsObject {
	mesh: MapsMesh;
	unlit?: boolean;
	color?: string;
	metalness?: number;
	roughness?: number;
	emissive?: string;
	lightMapIntensity?: number;
	map?: MapName;
	metalnessRoughnessMap?: MapName;
	normalMap?: MapName;
	aoMap?: MapName;
	emissiveMap?: MapName;
	lightMap?: MapName;
	uvTransform?: MapsUvTransform;
	position: Vec2;
	turn?: number;
}

/** Every object, top row first. */
export const MAPS_OBJECTS: readonly MapsObject[] = [
	{ mesh: 'sphere', map: 'checks', roughness: 0.6, position: [-3.6, 1.4] },
	{
		mesh: 'sphere',
		color: '#e0b060',
		metalness: 1,
		metalnessRoughnessMap: 'stripes',
		position: [-1.2, 1.4],
	},
	{
		mesh: 'quad',
		color: '#b0b8c8',
		roughness: 0.4,
		normalMap: 'ridges',
		position: [1.2, 1.4],
		turn: -0.3,
	},
	{
		mesh: 'tangent-square',
		color: '#b0b8c8',
		roughness: 0.4,
		normalMap: 'ridges',
		position: [3.6, 1.4],
		turn: -0.3,
	},
	{ mesh: 'quad', color: '#d0d0d0', aoMap: 'shadow', position: [-4.2, -1.4] },
	{
		mesh: 'quad',
		color: '#303440',
		emissive: '#ffffff',
		emissiveMap: 'glow',
		position: [-2.1, -1.4],
	},
	{
		mesh: 'second-uv-square',
		color: '#d0d0d0',
		lightMap: 'baked',
		lightMapIntensity: 2,
		position: [0, -1.4],
	},
	{ mesh: 'quad', map: 'checks', uvTransform: TRANSFORM, position: [2.1, -1.4] },
	{ mesh: 'quad', unlit: true, map: 'checks', uvTransform: TRANSFORM, position: [4.2, -1.4] },
];

/** The map options of an object, in the order the materials take them. */
export const MAP_OPTIONS = [
	'map',
	'metalnessRoughnessMap',
	'normalMap',
	'aoMap',
	'emissiveMap',
	'lightMap',
] as const satisfies readonly (keyof MapsObject)[];
