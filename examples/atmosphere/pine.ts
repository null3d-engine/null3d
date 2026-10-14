// The atmosphere demo's pine, made in code at four levels of detail: a trunk under eight tiers of
// boughs, each tier ragged around its edge and drooping at its tips, in mottled greens that lighten
// toward the tips' new growth. Every level samples the same shape, and each coarser level's error
// is measured against that shape when the pine is made.
import { type Geometry, type MeshGeometry, math } from '@null3d/engine';
import { type Arrays, grid, TURN } from '../lib/pines';
import { Noise } from '../lib/procedural';

/** Each level's segments around a tier and its rings from the tier's base to its tip. */
const LEVELS = [
	[30, 4],
	[14, 2],
	[7, 1],
	[4, 1],
] as const;
/** The tiers of boughs, lowest first, for a tree 1 high: base height, radius and height. */
const TIERS = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [0.12 + k * 0.1, 0.34 - k * 0.037, 0.2] as const);
const noise = new Noise(23);

/** How far tier `k`'s boughs reach at turn `u` around the tree, about 0.6 to 1.1. */
const bough = (k: number, u: number) =>
	0.85 + 0.2 * Math.sin(u * TURN * 5 + k * 2) + 0.25 * noise.value2(u * 12, k * 5, 12);

/** The point of tier `k` at turn `u` around it and height `h` from its base to its tip. */
function tierPoint(k: number, u: number, h: number): [number, number, number] {
	const [y, radius, height] = TIERS[k] as readonly [number, number, number];
	const reach = bough(k, u);
	const e = radius * (1 - h) ** 1.3 * math.lerp(reach, 1, h);
	const a = u * TURN + k;
	return [Math.cos(a) * e, y + height * h - 0.35 * radius * reach * (1 - h) ** 2, Math.sin(a) * e];
}

/** A pine 1 high with `around` segments around each tier and `rings` up it. */
function pine(around: number, rings: number): Arrays {
	const out: Arrays = { positions: [], colors: [], indices: [] };
	grid(out, Math.min(around, 8), 1, (u, h) => {
		const a = u * TURN;
		return [Math.cos(a) * 0.03, h * 0.45, Math.sin(a) * 0.03, 0.16, 0.09, 0.05];
	});
	for (let k = 0; k < TIERS.length; k++)
		grid(out, around, rings, (u, h) => {
			const tone = (0.55 + 0.45 * h) * (1 + 0.35 * noise.value2(u * 40, h * 6 + k * 9, 40));
			const fresh = (1 - h) ** 3;
			return [
				...tierPoint(k, u, h),
				(0.01 + 0.035 * fresh) * tone,
				(0.1 + 0.1 * fresh) * tone,
				(0.035 + 0.012 * fresh) * tone,
			];
		});
	return out;
}

/**
 * The farthest that a level's tiers stray from the true shape, for a tree 1 high: the distance
 * from each sampled point of the shape to the level's flat quad over it.
 */
function levelError(around: number, rings: number): number {
	let worst = 0;
	for (let k = 0; k < TIERS.length; k++)
		for (let i = 0; i < 180; i++)
			for (let j = 0; j <= 8; j++) {
				const [u, h] = [i / 180, j / 8];
				const [cu, ch] = [Math.floor(u * around), Math.min(Math.floor(h * rings), rings - 1)];
				const [su, sh] = [u * around - cu, h * rings - ch];
				const corner = (du: number, dh: number) =>
					tierPoint(k, (cu + du) / around, (ch + dh) / rings);
				const [a, b, c, d] = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
				const flat = [0, 1, 2].map((n) =>
					math.lerp(math.lerp(a[n], b[n], su), math.lerp(c[n], d[n], su), sh),
				);
				const p = tierPoint(k, u, h);
				worst = Math.max(worst, Math.hypot(p[0] - flat[0], p[1] - flat[1], p[2] - flat[2]));
			}
	return worst;
}

/** A pine 1 high whose base mesh names its three coarser levels, each with its error. */
export function pineWithLevels(geometry: Geometry): MeshGeometry {
	const [base, ...coarser] = LEVELS.map(([around, rings]) =>
		geometry.fromArrays({ ...pine(around, rings), computeNormals: true }),
	);
	(base as MeshGeometry).setLevels(
		coarser.map((mesh, n) => {
			const [around, rings] = LEVELS[n + 1] as readonly [number, number];
			return { mesh, error: levelError(around, rings) };
		}),
	);
	return base as MeshGeometry;
}
