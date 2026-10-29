// The impostors demo's scenery, made in code: the shared pine generator on rolling hills, split by
// distance from the middle into three bands. The nearest band stands as level-of-detail meshes in
// one instance batch, the middle band as one merged mesh per grid cell, and the farthest as cards
// of the octahedral atlas. The atlases are baked here from the pine's own mesh, so the cards show
// the tree's colour and normals and a moving sun lights them as it lights the mesh.
import { type DirectionalLight, math, type PerspectiveCamera } from '@null3d/engine';
import { bakeImpostorAtlas, type OctahedralAtlas, octahedralAtlas } from '@null3d/impostors';
import { ground, pineArrays } from '../lib/pines';

export { ground, hills, pineArrays, pineWithLevels } from '../lib/pines';

/** The side of the hills, in meters. */
export const SIDE = 1600;
/** The radius of the forest, in meters. */
export const RADIUS = 620;
/** Where the near band ends and the merged band begins, and where the cards begin. */
export const NEAR_EDGE = 140;
export const CARD_EDGE = 360;
/** The trees in each band. */
const COUNT = { near: 3600, middle: 5400, far: 3000 } as const;
/** The side of one grid cell of the merged band, in meters. */
export const CELL = 70;

/** One tree: where it stands, how far it is turned and how tall it is. */
export interface Tree {
	x: number;
	y: number;
	z: number;
	turn: number;
	scale: number;
}

/** The three bands of the forest, each nearer the middle than the next. */
export interface Bands {
	near: Tree[];
	middle: Tree[];
	far: Tree[];
}

/** Scatters `count` trees in the ring from `from` to `to` meters, from a fixed seed. */
function ring(count: number, from: number, to: number): Tree[] {
	const trees: Tree[] = [];
	for (let k = 0; k < count; k++) {
		const reach = Math.sqrt(from * from + (k + math.random()) * ((to * to - from * from) / count));
		const angle = math.randFloat(0, Math.PI * 2);
		const [x, z] = [Math.cos(angle) * reach, Math.sin(angle) * reach];
		trees.push({
			x,
			y: ground(x, z) - 0.3,
			z,
			turn: math.randFloat(0, Math.PI),
			scale: math.randFloat(9, 17),
		});
	}
	return trees;
}

/** The forest's three bands, from one seed so that every run draws the same trees. */
export function bands(): Bands {
	math.seed(17);
	return {
		near: ring(COUNT.near, 0, NEAR_EDGE),
		middle: ring(COUNT.middle, NEAR_EDGE, CARD_EDGE),
		far: ring(COUNT.far, CARD_EDGE, RADIUS),
	};
}

/** The part of an instance batch that a tree writes to. */
interface Batch {
	positions: Float32Array;
	rotations: Float32Array;
	scales: Float32Array;
	markDirty(first: number, count: number): void;
}

/** Puts each tree in `trees` into `batch` from copy `first`, and marks that range changed. */
export function fillTrees(batch: Batch, trees: readonly Tree[], first = 0): void {
	for (const [k, tree] of trees.entries()) {
		const at = first + k;
		batch.positions.set([tree.x, tree.y, tree.z], at * 3);
		batch.rotations.set([0, Math.sin(tree.turn / 2), 0, Math.cos(tree.turn / 2)], at * 4);
		batch.scales.fill(tree.scale, at * 3, at * 3 + 3);
	}
	batch.markDirty(first, trees.length);
}

/** A copy's transform, column-major: moved to the tree, turned about y and scaled. */
export function place({ x, y, z, turn, scale }: Tree): number[] {
	const [c, s] = [Math.cos(turn) * scale, Math.sin(turn) * scale];
	return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, x, y, z, 1];
}

/** The texels on each side of an atlas cell, and the cells of the atlas. */
const TEXELS = 64;
const CELLS = octahedralAtlas(16);

/**
 * The two octahedral atlases of the pine, baked from its most detailed mesh. The bake draws the
 * pine from every cell's direction with its own vertex colours, and stores each point's normal in
 * the tree's own frame, so a card lights as the mesh does and a turned copy lights from its turned
 * side. The bake runs on the CPU, so every GPU path draws the same card.
 */
export function impostorAtlases(): {
	atlas: OctahedralAtlas;
	color: { width: number; height: number; data: Uint8Array };
	surface: { width: number; height: number; data: Uint8Array };
	size: readonly [number, number];
} {
	const arrays = pineArrays(0);
	const bounds = boundsOf(arrays.positions);
	const bake = bakeImpostorAtlas({
		atlas: CELLS,
		texels: TEXELS,
		parts: [
			{
				positions: arrays.positions,
				colors: arrays.colors,
				indices: arrays.indices,
				// The near material draws both sides, so the bake does too.
				doubleSided: true,
			},
		],
		min: bounds.min,
		max: bounds.max,
	});
	return {
		atlas: bake.atlas,
		color: bake.color,
		surface: bake.surface,
		size: bake.size,
	};
}

/** The smallest and largest corner of a list of positions. */
function boundsOf(positions: readonly number[]): {
	min: [number, number, number];
	max: [number, number, number];
} {
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (let at = 0; at < positions.length; at += 3)
		for (let axis = 0; axis < 3; axis++) {
			const value = positions[at + axis] as number;
			if (value < (min[axis] as number)) min[axis] = value;
			if (value > (max[axis] as number)) max[axis] = value;
		}
	return { min, max };
}

/** Turns the sun to the hour's angle, about the world's z axis. */
export function turnSun(sun: DirectionalLight, hour: number): void {
	const turn = hour * Math.PI;
	sun.setRotation(0, 0, Math.sin(turn / 2), Math.cos(turn / 2));
}

/** Flies the camera slowly round the middle, looking out over the three bands. */
export function fly(camera: PerspectiveCamera, time: number): void {
	const t = time * 0.05;
	const [x, z] = [Math.sin(t) * 60, Math.cos(t) * 60];
	camera.setPosition(x, ground(x, z) + 32, z);
	camera.lookAt(Math.sin(t + 0.7) * CARD_EDGE * 1.6, 6, Math.cos(t + 0.7) * CARD_EDGE * 1.6);
}
