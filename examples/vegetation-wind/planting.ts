// The wind scene's land and stand: a meadow in a ring of wooded hills, and a grove of oaks, birches
// and firs with bushes and ferns at its feet. Every plant is made in code at four levels of
// detail, and every copy of a kind is a row of one instance batch, whose material bends it in the
// wind. A ring of the same trees on the hills gives the view its depth; it stands past the sway
// distance, so its shadows stay cached.
import { type InstanceBatch, type Material, math, type SketchContext } from '@null3d/engine';
import { ringLandArrays } from '../lib/land';
import { meshOf, meshOfLevels, smooth, TURN } from '../lib/trees';
import { type Crown, crownLevels } from './crowns';
import { fernParts } from './plants';

/** The land's height: a nearly level meadow, and hills that rise in a ring past the grove. */
export function land(x: number, z: number) {
	const roll = 0.5 * Math.sin(x * 0.07) * Math.cos(z * 0.05) + 0.35 * Math.sin((x - z) * 0.033);
	const a = Math.atan2(z, x);
	const hills = 22 + 14 * Math.sin(a * 3 + 0.5) + 7 * Math.sin(a * 7 + 2) + 5 * Math.sin(x * 0.02);
	return roll + smooth(110, 520, Math.hypot(x, z)) * hills;
}

/**
 * The land out to `far` meters, with texture coordinates every 4 m. Its colors run from the
 * meadow's greens, with drier patches, to the shade under the wood and the dark canopy of the hills.
 */
export function landArrays(far: number) {
	return ringLandArrays({
		far,
		rings: 120,
		around: 180,
		spacing: 2.2,
		tile: 4,
		height: land,
		color: (x, z, d) => {
			const dry = smooth(0.3, 0.9, Math.sin(x * 0.045 + 1) * Math.sin(z * 0.06 - 0.4));
			const wood = Math.max(smooth(70, 110, d), smooth(18, 6, Math.hypot(x, z + 34)) * 0.6);
			const patch = 0.85 + 0.15 * Math.sin(x * 0.21) * Math.sin(z * 0.17);
			const mix = (meadow: number, straw: number, under: number) =>
				((meadow * (1 - dry) + straw * dry) * (1 - wood) + under * wood) * patch;
			return [mix(0.15, 0.3, 0.035), mix(0.24, 0.27, 0.055), mix(0.06, 0.1, 0.022)];
		},
	});
}

/** One copy: its place, height, width, turn and tint. */
type Row = { x: number; z: number; height: number; width: number; tint: readonly number[] };

/** The kinds of the stand, each with its shape and how the wind bends it. */
export const OAK: Crown = {
	base: 0.3,
	middle: 0.62,
	radius: [0.36, 0.3],
	limbs: 6,
	sprays: 340,
	spray: 0.15,
	trunk: 0.03,
	hang: 0.1,
	seed: 3,
};
export const BIRCH: Crown = {
	base: 0.32,
	middle: 0.64,
	radius: [0.17, 0.32],
	limbs: 4,
	sprays: 420,
	spray: 0.12,
	trunk: 0.014,
	hang: 0.45,
	seed: 5,
};
export const BUSH: Crown = {
	base: 0.05,
	middle: 0.5,
	radius: [0.55, 0.45],
	limbs: 4,
	sprays: 120,
	spray: 0.32,
	trunk: 0.03,
	hang: 0.15,
	seed: 9,
};
export const FIR: Crown = {
	base: 0.1,
	middle: 0.5,
	radius: [0.24, 0.45],
	limbs: 0,
	sprays: 420,
	spray: 0.17,
	trunk: 0.022,
	hang: 0.4,
	seed: 7,
	shape: 'cone',
};

/** A cluster's copies: `count` rows scattered `spread` meters about each center. */
function cluster(
	centers: readonly (readonly [number, number])[],
	count: number,
	spread: number,
	height: readonly [number, number],
	tint: () => readonly number[],
): Row[] {
	return Array.from({ length: count }, (_, k) => {
		const [cx, cz] = centers[k % centers.length] as readonly [number, number];
		const [a, d] = [math.randFloat(0, TURN), spread * Math.sqrt(math.random())];
		return {
			x: cx + Math.cos(a) * d,
			z: cz + Math.sin(a) * d,
			height: math.randFloat(height[0], height[1]),
			width: math.randFloat(0.85, 1.2),
			tint: tint(),
		};
	});
}

/** Rows in a ring from `inner` to `outer` meters out, from a fixed spiral with jitter. */
function ring(count: number, inner: number, outer: number, height: readonly [number, number]) {
	return Array.from({ length: count }, (_, k): Row => {
		const out = Math.sqrt(inner ** 2 + ((outer ** 2 - inner ** 2) * (k + 0.5)) / count);
		const a = k * 2.39996 + math.randFloat(-0.3, 0.3);
		const b = math.randFloat(0.75, 1.05);
		return {
			x: Math.cos(a) * out + math.randFloat(-4, 4),
			z: Math.sin(a) * out + math.randFloat(-4, 4),
			height: math.randFloat(height[0], height[1]),
			width: math.randFloat(0.85, 1.15),
			tint: [b, b, b * math.randFloat(0.85, 1.05)],
		};
	});
}

/** A leafy green that varies a little from copy to copy. */
const leafy = (r: number, g: number, b: number) => () => {
	const lit = math.randFloat(0.8, 1.1);
	return [r * lit * math.randFloat(0.9, 1.1), g * lit, b * lit * math.randFloat(0.85, 1.1)];
};

/** The grove's trunks, which the grass and the ferns keep clear of. */
const OAKS = [
	[-17, -8],
	[15, -16],
	[-5, -30],
	[28, -4],
	[-33, -22],
	[6, -48],
	[36, -32],
	[-44, -2],
] as const;
const BIRCHES = [
	[9, 7],
	[-11, -12],
	[22, -24],
	[-24, -38],
] as const;
const FIRS = [
	[-20, -58],
	[18, -62],
	[44, -52],
	[-46, -46],
	[0, -70],
] as const;

/** The materials that each kind of plant draws with. */
export interface StandMaterials {
	readonly oak: Material;
	readonly birch: Material;
	readonly fir: Material;
	readonly bush: Material;
	readonly fern: Material;
}

/**
 * Plants the grove, its undergrowth and the wooded hills, one instance batch per kind.
 *
 * @returns The batches, and the places of the grove's trunks, which the grass keeps clear of.
 */
export function plantStand(
	ctx: SketchContext,
	materials: StandMaterials,
): { batches: InstanceBatch[]; trunks: [number, number][] } {
	const { scene, geometry } = ctx;
	math.seed(7);
	const oaks = [
		...cluster(OAKS, 8, 2, [10, 14], leafy(0.82, 0.9, 0.62)),
		...ring(260, 80, 330, [12, 20]),
	];
	const birches = cluster(BIRCHES, 18, 6, [11, 16], leafy(1.05, 0.98, 0.8));
	const firs = [
		...cluster(FIRS, 28, 9, [11, 23], leafy(0.85, 1, 0.85)),
		...ring(900, 85, 340, [14, 24]),
	];
	const trunks = [...oaks.slice(0, 8), ...birches];
	const clear = (x: number, z: number, gap: number) =>
		trunks.every((t) => Math.hypot(t.x - x, t.z - z) > gap);
	const bushes = cluster([...OAKS, ...FIRS], 70, 9, [1.2, 2.8], leafy(0.7, 0.85, 0.5)).filter((r) =>
		clear(r.x, r.z, 2),
	);
	const ferns = cluster([...OAKS, ...BIRCHES], 340, 9, [0.9, 1.6], leafy(0.9, 1, 0.8)).filter((r) =>
		clear(r.x, r.z, 1.2),
	);
	const kinds = [
		[meshOfLevels(geometry, crownLevels(OAK)), materials.oak, oaks, true],
		[meshOfLevels(geometry, crownLevels(BIRCH)), materials.birch, birches, true],
		[meshOfLevels(geometry, crownLevels(FIR)), materials.fir, firs, true],
		[meshOfLevels(geometry, crownLevels(BUSH)), materials.bush, bushes, true],
		[meshOf(geometry, fernParts()), materials.fern, ferns, true],
	] as const;
	const batches = kinds.map(([mesh, material, rows, castShadows]) => {
		const batch = scene.createInstances(mesh, rows.length, {
			material,
			castShadows,
			receiveShadows: true,
			colors: true,
		});
		const { positions, rotations, scales, colors } = batch;
		rows.forEach(({ x, z, height, width, tint }, row) => {
			const turn = math.randFloat(0, Math.PI);
			positions.set([x, land(x, z) - 0.1, z], row * 3);
			rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], row * 4);
			scales.set([height * width, height, height * width], row * 3);
			colors?.set([...tint, 1], row * 4);
		});
		batch.markDirty(0, rows.length);
		return batch;
	});
	return { batches, trunks: trunks.map((t): [number, number] => [t.x, t.z]) };
}
