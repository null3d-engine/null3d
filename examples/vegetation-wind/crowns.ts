// Leafy trees for the wind scene, made in code: a trunk and limbs of bark, and a crown of leaf sprays
// on cut-out cards that fill the crown's outer shell. Up close a crown then reads as leaves and
// light through gaps, where a closed surface would read as a blob. The cards' normals point out
// from the crown's middle, so the crown lights as one rounded mass. Each coarser level keeps a
// share of the sprays and makes them larger, so the crown's outline holds at a distance.
import { math } from '@null3d/engine';
import { BARK, band, build, type Part, TURN, woodTexture } from '../lib/trees';

/** A leafy tree 1 high: where its crown sits, how full it is, and the shape of its trunk. */
export interface Crown {
	/** The height where the limbs leave the trunk. */
	readonly base: number;
	/** The height of the crown's middle. */
	readonly middle: number;
	/** The crown's half width and half height. */
	readonly radius: readonly [number, number];
	/** The limbs from the trunk into the crown. */
	readonly limbs: number;
	/** The leaf sprays at the finest level. */
	readonly sprays: number;
	/** A spray card's size. */
	readonly spray: number;
	/** The trunk's radius at its foot. */
	readonly trunk: number;
	/** How far the sprays hang down, from 0 for upright to 1 for hanging. */
	readonly hang: number;
	/** The seed of the crown's layout. */
	readonly seed: number;
	/**
	 * A round crown about its middle, or a cone from the base to the tip, whose half width at the
	 * base is the first radius.
	 */
	readonly shape?: 'round' | 'cone';
}

/** The atlas row where the leaf sprays start, as v from the bottom; the bark sits below it. */
const LEAF_ROW = 0.27;

type Vec = readonly [number, number, number];
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const unit = (a: Vec): Vec => {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec, b: Vec): Vec => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];

/** A tapered limb of bark from `a` to `b`, `r0` thick at its foot and `r1` at its tip. */
function limb(a: Vec, b: Vec, r0: number, r1: number, around: number): Part {
	const axis = unit(add(b, a, -1));
	const side = unit(cross(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
	const other = cross(axis, side);
	return {
		at: (u, v) => {
			const [c, s] = [Math.cos(u * TURN), Math.sin(u * TURN)];
			const n = add(add([0, 0, 0], side, c), other, s);
			const r = r0 + (r1 - r0) * v;
			const p = add(add(a, add(b, a, -1), v), n, r);
			return [...p, ...n, u * 2, band(BARK, v), 0.9];
		},
		grids: [
			[around, 3],
			[Math.max(3, around - 2), 2],
			[3, 1],
			[3, 1],
		],
	};
}

/** The trunk and limbs of a crown, sampled once with the crown's seed. */
function wood(crown: Crown): Part[] {
	const { base, middle, radius, limbs, trunk } = crown;
	const top: Vec = [0, crown.shape === 'cone' ? 0.97 : middle + radius[1] * 0.45, 0];
	const parts = [limb([0, 0, 0], top, trunk, trunk * 0.25, 8)];
	for (let k = 0; k < limbs; k++) {
		const a = (k / limbs) * TURN + math.randFloat(-0.4, 0.4);
		const from: Vec = [0, base + (middle - base) * math.randFloat(0, 0.8), 0];
		const out = radius[0] * math.randFloat(0.55, 0.8);
		const to: Vec = [
			Math.cos(a) * out,
			middle + radius[1] * math.randFloat(-0.1, 0.55),
			Math.sin(a) * out,
		];
		parts.push(limb(from, to, trunk * 0.5, trunk * 0.12, 5));
	}
	return parts;
}

/** One spray: its place, the way it faces, its normal and its shade. */
type Spray = { at: Vec; face: Vec; up: Vec; normal: Vec; shade: number; flip: boolean };

/** The crown's sprays in its outer shell, the lower and inner ones darker. */
function sprays(crown: Crown): Spray[] {
	const { base, middle, radius, sprays: count, hang } = crown;
	const cone = crown.shape === 'cone';
	return Array.from({ length: count }, () => {
		const a = math.randFloat(0, TURN);
		const depth = 0.55 + 0.45 * math.random() ** 0.6;
		// A cone holds more sprays low down, where its ring is wider; its tiers of boughs bunch the
		// sprays into steps, so the outline breaks up.
		const rise = 1 - Math.sqrt(math.random());
		const tier = 0.75 + 0.25 * Math.abs(Math.sin(rise * 26));
		const y = cone ? rise * 2 - 1 : math.randFloat(-0.65, 1);
		const ring = cone ? 0 : Math.sqrt(1 - y * y);
		const dir: Vec = cone
			? unit([Math.cos(a), 0.45, Math.sin(a)])
			: [Math.cos(a) * ring, y, Math.sin(a) * ring];
		const reach = cone ? radius[0] * (1 - rise) ** 0.95 * tier * depth : 0;
		const at: Vec = cone
			? [Math.cos(a) * reach, base + (0.97 - base) * rise, Math.sin(a) * reach]
			: [
					dir[0] * radius[0] * depth,
					middle + dir[1] * radius[1] * depth,
					dir[2] * radius[0] * depth,
				];
		const face = unit(
			add(dir, [math.randFloat(-0.7, 0.7), math.randFloat(-0.3, 0.7), math.randFloat(-0.7, 0.7)]),
		);
		const level = Math.abs(face[1]) > 0.95 ? ([1, 0, 0] as Vec) : ([0, 1, 0] as Vec);
		const right = unit(cross(level, face));
		const upright = cross(face, right);
		const up = unit(add(add([0, 0, 0], upright, 1 - hang), [0, -1, 0], hang * 0.9));
		const normal = unit(add(add([0, 0, 0], dir, 0.75), face, 0.25));
		const shade = (0.4 + 0.6 * depth ** 2) * (0.75 + 0.25 * (0.5 + 0.5 * y));
		return { at, face, up, normal, shade, flip: math.random() < 0.5 };
	});
}

/**
 * A leafy tree 1 high at each of its four levels: the arrays, and the error of each level after
 * the base. A coarser level keeps one spray in two, larger by the square root of two, so the crown
 * keeps its cover, and its bark takes coarser rings.
 */
export function crownLevels(crown: Crown) {
	math.seed(crown.seed);
	const parts = wood(crown);
	const all = sprays(crown);
	return [0, 1, 2, 3].map((level) => {
		const out = build(parts, level) as ReturnType<typeof build> & { indices: number[] };
		const keep = 2 ** level;
		const size = crown.spray * Math.SQRT2 ** level;
		for (let k = 0; k < all.length; k += keep) {
			const { at, face, up, normal, shade, flip } = all[k] as Spray;
			const right = cross(up, face);
			const start = out.positions.length / 3;
			for (const [i, j] of [
				[-0.5, -0.5],
				[0.5, -0.5],
				[0.5, 0.5],
				[-0.5, 0.5],
			] as const) {
				out.positions.push(...add(add(at, right, i * size), up, j * size));
				out.normals.push(...normal);
				out.uvs.push(flip === i > 0 ? 0 : 1, LEAF_ROW + (1 - LEAF_ROW) * (j + 0.5));
				out.colors.push(shade, shade, shade);
			}
			out.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
		}
		return { arrays: out, error: level === 0 ? 0 : crown.spray * 0.5 * 2 ** level };
	});
}

/** A kind of leaf: its length and width on the card, its lobes, and its green. */
export interface Leaf {
	readonly length: number;
	readonly width: number;
	readonly lobes: number;
	readonly green: readonly [number, number, number];
	readonly count: number;
	/** The leaves' angle out from the twig, least and most, in radians. */
	readonly angle: readonly [number, number];
}

/**
 * The bark and leaf atlas, 256 texels square: the bark of the shared wood texture below, and a spray
 * of leaves on two twigs above, cut out by alpha. The leaves are drawn in the card's own square, so
 * they keep their shape on the card.
 */
export function leafAtlas(bark: 'furrowed' | 'birch', leaf: Leaf, seed: number, size = 256) {
	const wood = woodTexture(size, bark);
	const data = new Uint8Array(size * size * 4);
	const barkRows = Math.floor(size * LEAF_ROW);
	data.set(wood.data.subarray(0, barkRows * size * 4));
	for (let i = 3; i < barkRows * size * 4; i += 4) data[i] = 255;
	math.seed(seed);
	// The twigs run up the card, and the leaves leave them on alternate sides.
	const leaves: { x: number; y: number; a: number; tint: number }[] = [];
	for (const twig of [0.36, 0.64])
		for (let k = 0; k < leaf.count; k++) {
			const t = 0.08 + (0.88 * k) / leaf.count;
			const side = k % 2 === 0 ? 1 : -1;
			const bend = twig + 0.08 * Math.sin(t * 3 + twig * 9);
			leaves.push({
				x: bend,
				y: t,
				a: Math.PI / 2 - side * math.randFloat(leaf.angle[0], leaf.angle[1]),
				tint: math.randFloat(0.8, 1.15),
			});
		}
	const [r, g, b] = leaf.green;
	for (let py = barkRows; py < size; py++)
		for (let px = 0; px < size; px++) {
			const [x, y] = [(px + 0.5) / size, (py + 0.5 - barkRows) / (size - barkRows)];
			let color: number[] | null = null;
			for (const { x: lx, y: ly, a, tint } of leaves) {
				const [dx, dy] = [x - lx, y - ly];
				const along = (dx * Math.cos(a) + dy * Math.sin(a)) / leaf.length;
				if (along <= 0 || along >= 1) continue;
				const across = (-dx * Math.sin(a) + dy * Math.cos(a)) / leaf.width;
				const lobe = 1 + 0.2 * Math.sin(along * leaf.lobes * Math.PI) * (leaf.lobes > 0 ? 1 : 0);
				const half = Math.sin(Math.PI * along ** 0.8) ** 0.8 * lobe * 0.5;
				if (Math.abs(across) > half) continue;
				const vein = Math.abs(across) < 0.04 ? 1.25 : 1;
				const edge = 0.8 + 0.2 * (1 - Math.abs(across) / half);
				const lit = tint * vein * edge * (0.85 + 0.25 * along);
				color = [r * lit, g * lit, b * lit];
			}
			const twig = [0.36, 0.64].some(
				(t) => Math.abs(x - t - 0.08 * Math.sin(y * 3 + t * 9)) < 0.008,
			);
			if (!color && twig && y < 0.97) color = [92, 74, 52];
			const at = (py * size + px) * 4;
			if (color) data.set([...color.map((c) => Math.min(255, c)), 255], at);
			else data.set([r * 0.6, g * 0.6, b * 0.6, 0], at);
		}
	return { width: size, height: size, data };
}

/** An oak's broad leaves, in a deep green. */
export const OAK_LEAF: Leaf = {
	length: 0.2,
	width: 0.11,
	lobes: 5,
	green: [62, 98, 34],
	count: 9,
	angle: [0.5, 1.1],
};
/** A birch's small pointed leaves, in a light green. */
export const BIRCH_LEAF: Leaf = {
	length: 0.16,
	width: 0.09,
	lobes: 0,
	green: [96, 132, 46],
	count: 15,
	angle: [0.5, 1.1],
};
/** A fir's needles: many short dark blades along each twig, standing out at a steady angle. */
export const NEEDLES: Leaf = {
	length: 0.17,
	width: 0.05,
	lobes: 0,
	green: [40, 70, 36],
	count: 36,
	angle: [0.85, 1.1],
};
