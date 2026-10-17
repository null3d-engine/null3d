// The impostors demo's scenery, made in code: the shared pine generator on rolling hills, split by
// distance from the middle into three bands. The nearest band stands as level-of-detail meshes in
// one instance batch, the middle band as one merged mesh per grid cell, and the farthest as cards
// of the octahedral atlas. The atlas is drawn here too: each cell holds the pine as a cut-out seen
// from that cell's direction, lit by the sun from that side, so a card's picture changes as the
// camera moves around it.
import { math } from '@null3d/engine';
import { frameDirection, type OctahedralAtlas, octahedralAtlas } from '@null3d/impostors';
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
 * The octahedral atlas of a pine whose near band stands as meshes: every cell holds the tree's
 * cut-out seen from the cell's direction, shaded for the sun's side and height. `light` is the
 * direction the sunlight travels, so the sun sits opposite it. The rows run from the bottom up, as
 * `textures.fromData` reads them, and the cells count from the top left, as sprites show them.
 */
export function impostorAtlas(light: readonly [number, number, number]): {
	atlas: OctahedralAtlas;
	width: number;
	height: number;
	data: Uint8Array;
} {
	const { columns, rows } = CELLS;
	const width = columns * TEXELS;
	const height = rows * TEXELS;
	const data = new Uint8Array(width * height * 4);
	const sunAzimuth = Math.atan2(-(light[0] as number), -(light[2] as number));
	const direction: [number, number, number] = [0, 0, 0];
	for (let frame = 0; frame < columns * rows; frame++) {
		frameDirection(frame, CELLS, direction);
		const [dx, dy, dz] = direction;
		// A view toward the sun sees the dark side of the canopy, and one away from it the lit side.
		const fromSun = 0.5 - 0.5 * Math.cos(Math.atan2(dx, dz) - sunAzimuth);
		const lit = (0.5 + 0.5 * fromSun) * (0.85 + 0.15 * dy);
		const left = (frame % columns) * TEXELS;
		const bottom = (rows - 1 - Math.floor(frame / columns)) * TEXELS;
		for (let y = 0; y < TEXELS; y++)
			for (let x = 0; x < TEXELS; x++) {
				// The texel's place across the tree, and its height from the ground.
				const [across, up] = [((x + 0.5) / TEXELS - 0.5) * 2, (y + 0.5) / TEXELS];
				const edge = 1 - 2 / TEXELS;
				const canopyEdge = canopy(up) * (1 + 0.06 * Math.sin(up * 40));
				const foliage = Math.abs(across) < canopyEdge && up > 0.1 && up < 0.99;
				const bole = Math.abs(across) < 0.035 && up < 0.72;
				const at = ((bottom + y) * width + left + x) * 4;
				if (!foliage && !bole) continue;
				// Darker toward the outline, as a needle canopy is, and green deep inside.
				const inside = foliage ? 1 - Math.abs(across) / Math.max(canopyEdge, 0.001) : 1;
				const shade = (foliage ? 0.55 + 0.45 * inside : 0.5) * lit * (0.75 + 0.35 * up) * edge;
				const color = foliage ? [26, 74, 34] : [58, 44, 32];
				data[at] = Math.min(255, (color[0] as number) * shade);
				data[at + 1] = Math.min(255, (color[1] as number) * shade);
				data[at + 2] = Math.min(255, (color[2] as number) * shade);
				data[at + 3] = 255;
			}
	}
	return { atlas: CELLS, width, height, data };
}
