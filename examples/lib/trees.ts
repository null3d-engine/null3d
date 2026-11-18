// Trees made in code at four levels of detail, for any demo. Firs and broadleaf trees are each built
// from one surface formula, sampled on finer or coarser grids for the four levels. Each fir's tiers
// keep their branch tips on every level, and every level has the same normals, so the outline and
// the shading hold when a tree switches. A plant of a demo's own parts takes the same levels. One
// texture holds bark, needles and leaves in three bands, and the parts read their own band.
import { type Geometry, math } from '@null3d/engine';

export const TURN = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
export const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/**
 * One part's point at u around and v along it: x, y, z, normal, texture u and v, then a gray shade
 * or a red, green and blue, then optionally a second pair of texture coordinates.
 */
export type At = (u: number, v: number) => number[];
/** A tree part, and its columns and rows at each level, from the base level down. */
export type Part = { at: At; grids: readonly (readonly [number, number])[] };
type Arrays = { positions: number[]; normals: number[]; uvs: number[]; colors: number[] };

/** The rows of the texture's bark, needles and leaves, as v from the bottom. */
export const BARK = [0.01, 0.24] as const;
export const NEEDLES = [0.26, 0.74] as const;
export const LEAVES = [0.76, 0.99] as const;
export const band = ([lo, hi]: readonly [number, number], v: number) => lo + (hi - lo) * v;

/** A firm, upright normal that leans out from the trunk: soft light, the same on every level. */
export const lean = (a: number, up: number) => {
	const k = 1 / Math.hypot(1, up);
	return [Math.cos(a) * k, up * k, Math.sin(a) * k];
};

/** A trunk from the ground to `top`, `radius` wide at its foot. */
export const trunk = (top: number, radius: number): Part => ({
	at: (u, v) => {
		const [a, r] = [u * TURN, radius * (1 - 0.75 * v)];
		return [Math.cos(a) * r, v * top, Math.sin(a) * r, ...lean(a, 0.1), u * 2, band(BARK, v), 1];
	},
	grids: [
		[8, 1],
		[6, 1],
		[4, 1],
		[3, 1],
	],
});

/** A fir: its tiers, the height of its lowest branches, its width, branches per tier, droop. */
export type Fir = { tiers: number; low: number; width: number; branches: number; droop: number };
/** A broadleaf tree: the top of its bare trunk, its crown's width, and its crown's grids. */
export type Broadleaf = {
	crown: number;
	width: number;
	grids?: readonly (readonly [number, number])[];
};
export type Kind = Fir | Broadleaf;

/** The tiers of a fir 1 high, each a ring of drooping branches around the trunk. */
function firParts({ tiers, low, width, branches, droop }: Fir): Part[] {
	const h = (1.8 * (1 - low)) / tiers;
	const parts = Array.from({ length: tiers }, (_, k): Part => {
		const tip = low + h + ((1 - low - h) * k) / (tiers - 1);
		const radius = width * (1 - (0.85 * k) / tiers);
		const turn = k * 1.7;
		return {
			at: (u, v) => {
				// One branch per lobe: its tip sticks out and hangs lower than the gap beside it.
				const s = (0.5 + 0.5 * Math.cos(branches * u * TURN)) ** 2;
				const r = radius * v ** 0.9 * (0.68 + 0.32 * s);
				const y = tip - h * v ** 1.2 - droop * radius * v * v * s;
				const a = u * TURN + turn;
				const shade = (0.4 + 0.6 * v ** 0.7) * (0.8 + 0.2 * s) * (0.8 + (0.3 * k) / tiers);
				const uv = [u * branches + 0.5, band(NEEDLES, v)];
				return [Math.cos(a) * r, y, Math.sin(a) * r, ...lean(a, 0.9 - 0.5 * v), ...uv, shade];
			},
			// The coarser levels keep a vertex at every branch tip, or at every other one.
			grids: [
				[branches * 4, 6],
				[branches * 2, 3],
				[branches, 2],
				[branches / 2, 1],
			],
		};
	});
	return [trunk(0.95, 0.02 + width * 0.05), ...parts];
}

/** A crown's columns and rows at each level, from the base level down, for a tree of its size. */
const CROWN_GRIDS = [
	[28, 14],
	[14, 7],
	[8, 4],
	[5, 3],
] as const;

/** A broadleaf tree 1 high: a trunk, and a lumpy crown of leaves. */
function broadleafParts({ crown, width, grids = CROWN_GRIDS }: Broadleaf): Part[] {
	const at: At = (u, v) => {
		const [a, t] = [u * TURN, v * Math.PI];
		const [sin, cos] = [Math.sin(t), Math.cos(t)];
		const lump =
			1 +
			sin * (0.18 * Math.sin(3 * a + 1.3) * Math.sin(2 * t + 0.4)) +
			sin * (0.12 * Math.sin(5 * a) * Math.sin(3 * t + 1) + 0.08 * Math.sin(9 * a + 2));
		const [r, y] = [width * lump * sin, (1 - crown) * lump * cos * (cos < 0 ? 0.6 : 1)];
		const shade = (0.45 + 0.55 * (1 - v) ** 0.8) * (1 + 1.5 * (lump - 1));
		const uv = [u * 5, band(LEAVES, 1 - v)];
		return [Math.cos(a) * r, crown + y, Math.sin(a) * r, ...lean(a, 1.6 * cos), ...uv, shade];
	};
	return [trunk(crown, 0.03), { at, grids }];
}

/** The parts' grids at one level, as arrays for geometry.fromArrays. */
export function build(parts: Part[], level: number) {
	const out: Arrays = { positions: [], normals: [], uvs: [], colors: [] };
	const uvs1: number[] = [];
	const indices: number[] = [];
	for (const { at, grids } of parts) {
		const [columns, rows] = grids[level] as readonly [number, number];
		const start = out.positions.length / 3;
		for (let r = 0; r <= rows; r++)
			for (let c = 0; c <= columns; c++) {
				const p = at(c / columns, r / rows);
				const [x, y, z, nx, ny, nz, tu, tv, shade] = p as number[];
				out.positions.push(x as number, y as number, z as number);
				out.normals.push(nx as number, ny as number, nz as number);
				out.uvs.push(tu as number, tv as number);
				if (p.length >= 11) out.colors.push(...(p.slice(8, 11) as number[]));
				else out.colors.push(shade as number, shade as number, shade as number);
				if (p.length >= 13) uvs1.push(p[11] as number, p[12] as number);
				const i = start + r * (columns + 1) + c;
				if (r < rows && c < columns)
					indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
			}
	}
	return { ...out, ...(uvs1.length > 0 && { uvs1 }), indices };
}

/**
 * A level's error: the farthest that its surface strays from the parts' true surface, measured at
 * nine points inside each of its cells, in the units of a tree 1 high.
 */
function error(parts: Part[], level: number) {
	let worst = 0;
	for (const { at, grids } of parts) {
		const [columns, rows] = grids[level] as readonly [number, number];
		for (let r = 0; r < rows; r++)
			for (let c = 0; c < columns; c++) {
				const corner = (i: number, j: number) => at((c + i) / columns, (r + j) / rows);
				const [p00, p10, p01, p11] = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
				for (const i of [0.25, 0.5, 0.75])
					for (const j of [0.25, 0.5, 0.75]) {
						const p = at((c + i) / columns, (r + j) / rows);
						let d = 0;
						for (let k = 0; k < 3; k++) {
							const mix = (a: number[], b: number[]) =>
								(a[k] as number) * (1 - i) + (b[k] as number) * i;
							const q = mix(p00, p10) * (1 - j) + mix(p01, p11) * j;
							d += ((p[k] as number) - q) ** 2;
						}
						worst = Math.max(worst, Math.sqrt(d));
					}
			}
	}
	return worst;
}

/** The parts of a tree of this kind, 1 high. */
export function partsOf(kind: Kind): Part[] {
	return 'tiers' in kind ? firParts(kind) : broadleafParts(kind);
}

/** Parts at each of their four levels: the arrays, and the error of each level after the base. */
export function partLevels(parts: Part[]) {
	let last = 0;
	return [0, 1, 2, 3].map((level) => {
		last = level === 0 ? 0 : Math.max(error(parts, level), last * 1.25);
		return { arrays: build(parts, level), error: last };
	});
}

/** A tree 1 high at each of its four levels: its arrays, and its error after the base level. */
export const treeLevels = (kind: Kind) => partLevels(partsOf(kind));

/**
 * The costliest mesh of a kind, or of a plant's own parts, which names the three coarser ones with
 * their errors. Every row of an instance batch of it then picks its own level. The levels are set
 * by hand: a plant's material bends its vertices, which the planner's levels do not allow for, and
 * the parts' own grids give each level's exact error.
 */
export function meshOf(geometry: Geometry, kind: Kind | Part[]) {
	const levels = partLevels(Array.isArray(kind) ? kind : partsOf(kind));
	const [base, ...coarser] = levels.map(({ arrays, error }) => ({
		mesh: geometry.fromArrays(arrays),
		error,
	}));
	base?.mesh.setLevels(coarser);
	return base?.mesh ?? geometry.box();
}

/** The widest a tree of this kind reaches from its trunk, and its outline at height y. */
export const reach = (kind: Kind) => ('tiers' in kind ? kind.width : kind.width * 1.3);
export function outline(kind: Kind, y: number, jag: number) {
	if (!('tiers' in kind)) {
		const t = (y - kind.crown) / ((1 - kind.crown) * (y < kind.crown ? 0.6 : 1));
		return Math.abs(t) < 1 ? kind.width * Math.sqrt(1 - t * t) * (0.85 + 0.25 * jag) : 0;
	}
	const { tiers, low, width, droop } = kind;
	const h = (1.8 * (1 - low)) / tiers;
	let widest = 0;
	for (let k = 0; k < tiers; k++) {
		const tip = low + h + ((1 - low - h) * k) / (tiers - 1);
		const radius = width * (1 - (0.85 * k) / tiers);
		if (y > tip || y < tip - h - droop * radius * jag) continue;
		const v = Math.min((tip - y) / h, 1) ** (1 / 1.2);
		widest = Math.max(widest, radius * v ** 0.9 * (0.7 + 0.3 * jag));
	}
	return widest;
}

/**
 * The bark, needles and leaves texture, 256 texels square. Each band repeats across u: furrowed
 * bark, or a birch's pale bark with its dark bands and patches; one branch of needles, its stem up
 * the middle and its needles slanting out; clumps of leaves.
 */
export function woodTexture(size = 256, bark: 'furrowed' | 'birch' = 'furrowed') {
	const data = new Uint8Array(size * size * 4).fill(255);
	math.seed(5);
	const grain = Float32Array.from({ length: size * size }, () => math.randFloat(0.8, 1.2));
	// Leaf clumps: a jittered point in each cell of a grid that repeats across u.
	const cell = 16;
	const points = Array.from({ length: (size / cell) ** 2 }, () => [math.random(), math.random()]);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [u, v, g] = [x / size, (y + 0.5) / size, grain[y * size + x] as number];
			let rgb: number[];
			if (v < NEEDLES[0]) {
				if (bark === 'birch') {
					const lenticel = frac(v * 70 + 0.2 * Math.sin(u * TURN * 3)) < 0.09;
					const dash = lenticel && Math.sin(u * TURN * 5 + v * 90) > -0.2;
					const patch = Math.sin(u * TURN * 2 + v * 17) * Math.sin(v * 37 + u * TURN) > 0.72;
					const dark = dash || patch ? 0.28 : 1;
					rgb = [222, 216, 200].map((c) => c * dark * (0.9 + 0.1 * g));
				} else {
					const furrow = 0.5 + 0.5 * Math.sin(u * TURN * 7 + 1.8 * Math.sin(v * 40 + u * TURN * 2));
					rgb = [96, 78, 62].map((c) => c * (0.35 + 0.65 * furrow ** 1.5) * g);
				}
			} else if (v < LEAVES[0]) {
				const along = (v - NEEDLES[0]) / (NEEDLES[1] - NEEDLES[0]);
				const side = Math.abs(u - 0.5);
				const needle = frac(along * 30 - side * 14) < 0.45 ? 1 : 0.55;
				const lit = Math.max(0, 1 - side * 1.7) * needle * (0.55 + 0.45 * along);
				const tip = smooth(0.82, 1, along) * needle;
				rgb = [26 + 34 * lit + 50 * tip, 52 + 52 * lit + 46 * tip, 28 + 22 * lit].map((c) => c * g);
			} else {
				let near = 9;
				const [cx, cy] = [Math.floor(x / cell), Math.floor(y / cell)];
				for (let j = -1; j <= 1; j++)
					for (let i = -1; i <= 1; i++) {
						const [px, py] = [(cx + i + size / cell) % (size / cell), cy + j];
						const point = points[
							(((py % (size / cell)) + size / cell) % (size / cell)) * (size / cell) + px
						] ?? [0, 0];
						const dx = (cx + i + (point[0] as number)) * cell - x;
						const dy = (cy + j + (point[1] as number)) * cell - y;
						near = Math.min(near, Math.hypot(dx, dy) / cell);
					}
				const clump = Math.max(0, 1 - near * 1.1);
				rgb = [70 + 62 * clump, 92 + 66 * clump, 38 + 30 * clump].map(
					(c) => c * (0.6 + 0.5 * clump) * g,
				);
			}
			data.set(
				rgb.map((c) => Math.min(255, c)),
				(y * size + x) * 4,
			);
		}
	return { width: size, height: size, data };
}

/**
 * The bush of the understory: a broad crown, low enough that it reaches the ground, sampled on
 * coarser grids than a tree's, because a bush covers few pixels.
 */
export const BUSH: Broadleaf = {
	crown: 0.22,
	width: 0.42,
	grids: [
		[14, 7],
		[8, 4],
		[5, 3],
		[4, 2],
	],
};
