// The impostors demo's scenery, made in code: the shared pine generator on rolling hills, split by
// distance from the middle into three bands. The nearest band stands as level-of-detail meshes in
// one instance batch, the middle band as one merged mesh per grid cell, and the farthest as cards
// of the octahedral atlas. The atlases are drawn here too: each cell holds the pine as a cut-out
// seen from that cell's direction, with the colour of its needles and its normal and depth, so the
// card is lit by the sun that the scene has now and a moving sun turns across it.
import { math } from '@null3d/engine';
import {
	encodeImpostorSurface,
	frameDirection,
	type OctahedralAtlas,
	octahedralAtlas,
} from '@null3d/impostors';
import { ground } from '../lib/pines';

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
const TEXELS = 32;
const CELLS = octahedralAtlas(16);

/** The pine's tiers: each one's base height, radius and height, in units of a tree 1 high. */
const TIERS = [
	[0.12, 0.34, 0.5],
	[0.32, 0.27, 0.43],
	[0.52, 0.2, 0.36],
] as const;

/** The canopy's half width at height `y` of a pine 1 high, from the tiers of the shared generator. */
function canopy(y: number): number {
	let widest = 0;
	for (const [base, radius, height] of TIERS) {
		if (y < base || y > base + height) continue;
		widest = Math.max(widest, radius * (1 - (y - base) / height) ** 1.5);
	}
	return widest;
}

/**
 * The two octahedral atlases of a pine whose near band stands as meshes. Every cell of the colour
 * atlas holds the tree's cut-out seen from the cell's direction, as its own colour, with no light
 * in it: the card material lights it from the sun that the scene has now. The surface atlas holds
 * the same cells' normals, in each view's space, and their depth, so the light bends across the
 * canopy and the cards of a turning sun stay lit from the side it stands on. The rows run from the
 * bottom up, as `textures.fromData` reads them, and the cells count from the top left, as sprites
 * show them.
 */
export function impostorAtlases(): {
	atlas: OctahedralAtlas;
	color: { width: number; height: number; data: Uint8Array };
	surface: { width: number; height: number; data: Uint8Array };
} {
	const { columns, rows } = CELLS;
	const width = columns * TEXELS;
	const height = rows * TEXELS;
	const color = new Uint8Array(width * height * 4);
	const surface = new Uint8Array(width * height * 4);
	const direction: [number, number, number] = [0, 0, 0];
	const normal: [number, number, number] = [0, 0, 1];
	const texel = new Uint8Array(4);
	for (let frame = 0; frame < columns * rows; frame++) {
		frameDirection(frame, CELLS, direction);
		const left = (frame % columns) * TEXELS;
		const bottom = (rows - 1 - Math.floor(frame / columns)) * TEXELS;
		for (let y = 0; y < TEXELS; y++)
			for (let x = 0; x < TEXELS; x++) {
				// The texel's place across the tree, and its height from the ground.
				const [across, up] = [((x + 0.5) / TEXELS - 0.5) * 2, (y + 0.5) / TEXELS];
				const canopyEdge = canopy(up) * (1 + 0.06 * Math.sin(up * 40));
				const foliage = Math.abs(across) < canopyEdge && up > 0.1 && up < 0.99;
				const bole = Math.abs(across) < 0.035 && up < 0.72;
				if (!foliage && !bole) continue;
				const at = ((bottom + y) * width + left + x) * 4;
				// Darker toward the outline and greener inside, as a needle canopy's own colour is.
				const inside = foliage ? 1 - Math.abs(across) / Math.max(canopyEdge, 0.001) : 1;
				const shade = (foliage ? 0.55 + 0.45 * inside : 0.5) * (0.75 + 0.35 * up);
				const tone = foliage ? [26, 74, 34] : [58, 44, 32];
				color[at] = Math.min(255, (tone[0] as number) * shade);
				color[at + 1] = Math.min(255, (tone[1] as number) * shade);
				color[at + 2] = Math.min(255, (tone[2] as number) * shade);
				color[at + 3] = 255;
				// The side of the tree that this point shows faces out of the plant, so its normal
				// turns across the picture toward the outline; the canopy also tilts up.
				const side = Math.max(-1, Math.min(1, across / Math.max(canopyEdge, 0.05)));
				normal[0] = side;
				normal[1] = foliage ? 0.35 : 0;
				normal[2] = Math.sqrt(Math.max(0, 1 - side * side));
				const reach = Math.hypot(normal[0], normal[1], normal[2]) || 1;
				normal[0] /= reach;
				normal[1] /= reach;
				normal[2] /= reach;
				encodeImpostorSurface(normal, 1 - normal[2], 1, texel);
				surface[at] = texel[0] as number;
				surface[at + 1] = texel[1] as number;
				surface[at + 2] = texel[2] as number;
				surface[at + 3] = texel[3] as number;
			}
	}
	return {
		atlas: CELLS,
		color: { width, height, data: color },
		surface: { width, height, data: surface },
	};
}
