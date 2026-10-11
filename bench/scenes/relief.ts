// The relief scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports: bump maps, displacement
// maps and wireframes of the standard and unlit materials, under the benchmark scenes' lights. Top
// row: a bump map on a quad and on a sphere, then a displaced quad with the normal map of its
// heights and a displaced sphere with a bump map, so both engines light them alike. Bottom row: wireframes of a lit
// sphere, an unlit torus and a displaced quad, and a bump map with a negative scale. A displaced
// surface without a normal map shades differently by design (D-136), so it has a test of its own.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, SUN } from './spec';

type Vec2 = readonly [number, number];
type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const RELIEF_IMAGE = PARITY_CANVAS;

/** The clear color, a mid gray, as the texture maps scene has it. */
export const RELIEF_BACKGROUND = '#60666e';

/** The perspective camera. */
export const RELIEF_CAMERA = {
	fov: 35,
	near: 0.1,
	far: 50,
	position: [0, 0, 10],
	target: [0, 0, 0],
} as const satisfies { fov: number; near: number; far: number; position: Vec3; target: Vec3 };

/** Texels along each side of every map. */
export const RELIEF_MAP_SIZE = 64;

/** The height of the bumps at column x and row y, from 0 to 1: a grid of round domes. */
function bump(x: number, y: number): number {
	const u = ((x + 0.5) / RELIEF_MAP_SIZE) * Math.PI * 8;
	const v = ((y + 0.5) / RELIEF_MAP_SIZE) * Math.PI * 8;
	return (Math.sin(u) * Math.sin(v)) ** 2;
}

/** The height of the hills at column x and row y, from 0 to 1: one wide dome with a ring. */
function hill(x: number, y: number): number {
	const dx = (x + 0.5) / RELIEF_MAP_SIZE - 0.5;
	const dy = (y + 0.5) / RELIEF_MAP_SIZE - 0.5;
	const r = Math.hypot(dx, dy) * 2;
	const dome = Math.max(0, 1 - r * r);
	return dome * (0.75 + 0.25 * Math.cos(r * Math.PI * 4));
}

/**
 * The tangent-space normal of a height field at a texel, from its slope between the texels around
 * it, for a surface whose texture runs `extent` world units across and moves `scale` world units
 * per unit of height. Rows count up v, as both engines place row 0 at v = 0.
 */
function normalOf(height: (x: number, y: number) => number, scale: number, extent: number) {
	return (x: number, y: number): number[] => {
		const step = extent / RELIEF_MAP_SIZE;
		const last = RELIEF_MAP_SIZE - 1;
		const clamp = (i: number) => Math.min(Math.max(i, 0), last);
		const at = (i: number, j: number) => height(clamp(i), clamp(j));
		const du = ((at(x + 1, y) - at(x - 1, y)) * scale) / (2 * step);
		const dv = ((at(x, y + 1) - at(x, y - 1)) * scale) / (2 * step);
		const length = Math.hypot(du, dv, 1);
		return [
			(-du / length) * 127.5 + 127.5,
			(-dv / length) * 127.5 + 127.5,
			(1 / length) * 127.5 + 127.5,
			255,
		];
	};
}

/** One map: its texels as RGBA bytes at column x and row y. Every map is linear. */
export interface ReliefMap {
	texel(x: number, y: number): readonly number[];
}

/** A height as a gray texel. */
const gray = (height: number) => {
	const value = Math.round(height * 255);
	return [value, value, value, 255];
};

/** How far the hills' white moves a vertex, and how far every vertex moves, in the mesh's units. */
export const HILL_SCALE = 0.5;
export const HILL_BIAS = -0.1;

/** The quads' size and cells: dense enough for the hills' vertices to follow them. */
export const RELIEF_QUAD = {
	width: 1.6,
	height: 1.6,
	widthSegments: 64,
	heightSegments: 64,
} as const;
/** The spheres' radius and segments. */
export const RELIEF_SPHERE = { radius: 0.7, widthSegments: 96, heightSegments: 48 } as const;
/** The torus. */
export const RELIEF_TORUS = {
	radius: 0.55,
	tube: 0.2,
	radialSegments: 12,
	tubularSegments: 32,
} as const;

/** The scene's maps by name. */
export const RELIEF_MAPS = {
	bumps: { texel: (x, y) => gray(bump(x, y)) },
	hills: { texel: (x, y) => gray(hill(x, y)) },
	'hill-normals': { texel: normalOf(hill, HILL_SCALE, RELIEF_QUAD.width) },
} as const satisfies Record<string, ReliefMap>;

export type ReliefMapName = keyof typeof RELIEF_MAPS;

/** The texels of a map, row 0 first, which both engines place at v = 0. */
export function reliefTexels(map: ReliefMap): Uint8Array {
	const size = RELIEF_MAP_SIZE;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) data.set(map.texel(x, y), (y * size + x) * 4);
	return data;
}

export type ReliefMesh = 'quad' | 'sphere' | 'torus';

/** One object: its mesh, its material, where it stands, and its turn about x in radians. */
export interface ReliefObject {
	mesh: ReliefMesh;
	unlit?: boolean;
	color: string;
	roughness?: number;
	metalness?: number;
	bumpMap?: ReliefMapName;
	bumpScale?: number;
	normalMap?: ReliefMapName;
	displacementMap?: ReliefMapName;
	displacementScale?: number;
	displacementBias?: number;
	wireframe?: boolean;
	position: Vec2;
	turn?: number;
}

/** Every object, top row first. */
export const RELIEF_OBJECTS: readonly ReliefObject[] = [
	{
		mesh: 'quad',
		color: '#c8b8a0',
		roughness: 0.5,
		bumpMap: 'bumps',
		bumpScale: 6,
		position: [-3.6, 1.3],
		turn: -0.3,
	},
	{
		mesh: 'sphere',
		color: '#a0b8c8',
		roughness: 0.4,
		bumpMap: 'bumps',
		bumpScale: 4,
		position: [-1.2, 1.3],
	},
	{
		mesh: 'quad',
		color: '#b0c090',
		roughness: 0.8,
		displacementMap: 'hills',
		displacementScale: HILL_SCALE,
		displacementBias: HILL_BIAS,
		normalMap: 'hill-normals',
		position: [1.2, 1.3],
		turn: -0.9,
	},
	{
		mesh: 'sphere',
		color: '#d0a080',
		roughness: 0.7,
		displacementMap: 'bumps',
		displacementScale: 0.12,
		bumpMap: 'bumps',
		bumpScale: 2,
		position: [3.6, 1.3],
	},
	{
		mesh: 'sphere',
		color: '#e0e0e0',
		roughness: 0.3,
		metalness: 0.5,
		wireframe: true,
		position: [-3.6, -1.4],
	},
	{
		mesh: 'torus',
		unlit: true,
		color: '#ffcc40',
		wireframe: true,
		position: [-1.2, -1.4],
		turn: 0.6,
	},
	{
		mesh: 'quad',
		color: '#80d0ff',
		displacementMap: 'hills',
		displacementScale: HILL_SCALE,
		wireframe: true,
		position: [1.2, -1.4],
		turn: -0.9,
	},
	{
		mesh: 'quad',
		color: '#c8b8a0',
		roughness: 0.5,
		bumpMap: 'bumps',
		bumpScale: -6,
		position: [3.6, -1.4],
		turn: -0.3,
	},
];
