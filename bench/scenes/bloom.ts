// Bloom's scene, defined once for null3D's image tests and for its three.js twin, which the parity
// test compares them with. It is plain data with no engine imports: emissive spheres and a thin bar
// brighter than white glow over a dim ground, beside a lit box that stays below the threshold.
import { PARITY_CANVAS } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const BLOOM_IMAGE = PARITY_CANVAS;

/** The perspective camera: where it stands, the point it looks at, and its lens. */
export const BLOOM_CAMERA = {
	position: [0, 2.5, 9],
	target: [0, 0.5, 0],
	fov: 50,
	near: 0.1,
	far: 100,
} as const satisfies { position: Vec3; target: Vec3; fov: number; near: number; far: number };

/** The sRGB background color: dark, so the glow shows. */
export const BLOOM_BACKGROUND = '#06080c';

/** A dim sun, so only the emissive shapes pass the threshold, and a little ambient light. */
export const BLOOM_SUN = { direction: [-1, -2, -1], color: '#ffffff', intensity: 1.5 } as const;
export const BLOOM_AMBIENT = { color: '#ffffff', intensity: 0.2 } as const;

/**
 * A shape of the scene: a box of `size`, or a sphere whose radius is `size[0]`, at `position`, with
 * the standard material's sRGB color, roughness and emissive light.
 */
export interface BloomShape {
	kind: 'box' | 'sphere';
	size: Vec3;
	position: Vec3;
	color: string;
	roughness: number;
	emissive: string;
	emissiveIntensity: number;
}

const dark = { color: '#000000', roughness: 1 } as const;
const ball = { kind: 'sphere', size: [0.45, 0, 0] } as const;

/** The ground, the lit box, three glowing spheres, and a thin glowing bar. */
export const BLOOM_SHAPES: readonly BloomShape[] = [
	{
		kind: 'box',
		size: [12, 0.2, 6],
		position: [0, -0.6, 0],
		color: '#30343c',
		roughness: 0.9,
		emissive: '#000000',
		emissiveIntensity: 0,
	},
	{
		kind: 'box',
		size: [1, 1, 1],
		position: [-3.2, 0, 0],
		color: '#8090a0',
		roughness: 0.5,
		emissive: '#000000',
		emissiveIntensity: 0,
	},
	{ ...ball, ...dark, position: [-1.2, 0, 0], emissive: '#ff5030', emissiveIntensity: 6 },
	{ ...ball, ...dark, position: [0.4, 0, 0], emissive: '#40a0ff', emissiveIntensity: 5 },
	{ ...ball, ...dark, position: [2, 0, 0], emissive: '#ffe080', emissiveIntensity: 12 },
	{
		kind: 'box',
		size: [0.08, 2.2, 0.08],
		position: [3.4, 0.6, 0],
		...dark,
		emissive: '#ffffff',
		emissiveIntensity: 4,
	},
];

/** Each bloom that the tests draw, by name, with three.js's `UnrealBloomPass` meanings. */
export const BLOOM_SETTINGS = {
	soft: { strength: 0.5, radius: 0.2, threshold: 1 },
	strong: { strength: 1, radius: 0.8, threshold: 0.8 },
} as const;

export type BloomName = keyof typeof BLOOM_SETTINGS;

/** Prototype P2: today's steps with the strong settings, for timing against the mip chain. */
export const BLOOM_P2_UNREAL = { ...BLOOM_SETTINGS.strong, method: 'unreal' } as const;

/** Prototype P2: the mip chain that M2-F7 plans, for timing: a 512-row base and threshold 0. */
export const BLOOM_P2_MIP = {
	method: 'mip',
	intensity: 0.15,
	threshold: 0,
	knee: 0,
	levels: 8,
	baseRows: 512,
	karis: true,
	composite: 'mix',
	mixes: [0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85],
} as const;
