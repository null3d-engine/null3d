// The creek's land: a stream that winds along x through a valley, with a stony bed, low banks and
// slopes that rise to the valley's sides. Everything that stands on the ground asks this module for
// its height, so the grass, the stones and the water meet the ground where it is.
import type { SketchContext } from '@null3d/engine';
import { Noise, type TexelSample, terrain, textureSet } from '../../lib/procedural';

/** The height of the water's surface. */
export const WATER = 0;
/** The width and depth of the land, in meters, centered on the origin. */
export const LAND = 160;

const noise = new Noise(11);
const smoothstep = (x: number, a: number, b: number) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/** The z of the stream's middle at x: two gentle bends. */
export const streamZ = (x: number) => 1.4 * Math.sin(x * 0.11 + 0.6) + 0.5 * Math.sin(x * 0.27);

/** The half width of the water at x, at its surface. */
export const streamHalf = (x: number) => 1.9 + 0.45 * Math.sin(x * 0.19 + 1.3);

/** The farthest that the water reaches from z = 0: the largest bend plus the largest half width. */
export const STREAM_REACH = 1.9 + 2.35;

/** How far a point lies from the stream's middle, in half widths: 1 at the water's edge. */
export const fromStream = (x: number, z: number) => Math.abs(z - streamZ(x)) / streamHalf(x);

/** The height of the ground at a point. */
export function groundHeight(x: number, z: number): number {
	const d = fromStream(x, z);
	const bed = -0.62 + 0.12 * noise.fbm2(x * 0.7, z * 0.7, 3);
	// The banks: a low step at the water, then rolling ground, then the valley's sides.
	const across = Math.abs(z - streamZ(x));
	const rolling = 0.9 * noise.fbm2(x * 0.06 + 3, z * 0.06, 4) * smoothstep(d, 1.6, 4);
	const hills = 5 * noise.fbm2(x * 0.018 + 7, z * 0.018, 3) * smoothstep(across, 8, 20);
	const sides = 0.035 * Math.max(0, across - 14) ** 1.5 + Math.max(hills, -1);
	const bank = 0.22 + 0.3 * smoothstep(d, 1.1, 2.6) + rolling + sides;
	return bed + (bank - bed) * smoothstep(d, 0.72, 1.32);
}

/** Linear colors of the ground: the wet bed, mud at the water's edge, grassy soil and bare rock. */
const BED = [0.16, 0.14, 0.11];
const MUD = [0.075, 0.06, 0.045];
const SOIL = [0.075, 0.12, 0.035];
const DRY = [0.16, 0.15, 0.07];
const STONE = [0.2, 0.19, 0.17];
const MEADOW = [0.07, 0.15, 0.03];

/** The ground's color at a point, from its height and its slope, with patches from noise. */
function groundColor(x: number, z: number, y: number, slope: number, out: number[]): void {
	const wet = smoothstep(y, WATER + 0.18, WATER - 0.05);
	const under = smoothstep(y, WATER - 0.08, WATER - 0.3);
	const dry = smoothstep(noise.fbm2(x * 0.15, z * 0.15 + 9, 3), -0.05, 0.3);
	const rocky = smoothstep(slope, 0.55, 0.95);
	const shade = 0.85 + 0.3 * noise.value2(x * 2.3, z * 2.3);
	// Past the grass's reach, the ground itself takes the meadow's green.
	const meadow = smoothstep(Math.abs(z - streamZ(x)), 9, 14);
	for (let c = 0; c < 3; c++) {
		const soil = (SOIL[c] as number) + ((MEADOW[c] as number) - (SOIL[c] as number)) * meadow;
		const grassy = soil + ((DRY[c] as number) - soil) * dry;
		const shore = grassy + ((MUD[c] as number) - grassy) * wet;
		const ground = shore + ((BED[c] as number) - shore) * under;
		out[c] = (ground + ((STONE[c] as number) - ground) * rocky) * shade;
	}
}

/**
 * The texel of the ground's detail: soil clods and small stones, in a near-white tone, which the
 * vertex colors tint. It tiles over a period of whole noise cells.
 */
function groundTexel(u: number, v: number, out: TexelSample): void {
	const clods = noise.fbm2(u * 16, v * 16, 5, 16);
	// Small stones: the bright tops of a finer noise, raised and smoother than the soil.
	const grit = noise.fbm2(u * 32, v * 32, 2, 32);
	const stone = smoothstep(grit, 0.3, 0.5);
	out.height = clods * 6 + stone * 2;
	const tone = 0.8 + 0.25 * clods + 0.08 * stone;
	out.r = tone;
	out.g = tone * 0.97;
	out.b = tone * 0.92;
	out.roughness = 0.95 - 0.35 * stone;
	out.occlusion = 0.8 + 0.2 * smoothstep(clods, -0.3, 0.2);
}

/** Makes the ground's mesh, whose detail grows with the preset, and its material. */
export function createLand(
	{ scene, geometry, materials, textures }: SketchContext,
	quads: number,
	textureSize: number,
): void {
	const maps = textureSet(textures, textureSize, groundTexel);
	const mesh = geometry.fromArrays(
		terrain({
			size: LAND,
			quads,
			tile: 2.5,
			middle: 0.15,
			height: groundHeight,
			color: groundColor,
		}),
	);
	scene.createMesh({
		mesh,
		material: materials.standard({ vertexColors: true, roughness: 1, ...maps }),
		receiveShadows: true,
		castShadows: true,
	});
}
