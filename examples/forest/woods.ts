// The forest's trees and land, made in code. Three firs and a broadleaf tree are each built from
// one surface formula, sampled on finer or coarser grids for the four levels of detail. Each fir's
// tiers keep their branch tips on every level, and every level has the same normals, so the outline
// and the shading hold when a tree switches. A low understory of bushes covers the ground between
// the trunks, in the same four levels. One texture holds bark, needles and leaves; another holds a
// cut-out picture of each tree for the far cards. The hills rise into wooded ridges.
import { type Geometry, type InstanceBatch, math } from '@null3d/engine';

const TURN = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
	return t * t * (3 - 2 * t);
};

/** One tree part's point at u around and v along it: x, y, z, normal, texture u and v, shade. */
type At = (u: number, v: number) => number[];
/** A tree part, and its columns and rows at each level, from the base level down. */
type Part = { at: At; grids: readonly (readonly [number, number])[] };
type Arrays = { positions: number[]; normals: number[]; uvs: number[]; colors: number[] };

/** The rows of the texture's bark, needles and leaves, as v from the bottom. */
const BARK = [0.01, 0.24] as const;
const NEEDLES = [0.26, 0.74] as const;
const LEAVES = [0.76, 0.99] as const;
const band = ([lo, hi]: readonly [number, number], v: number) => lo + (hi - lo) * v;

/** A firm, upright normal that leans out from the trunk: soft light, the same on every level. */
const lean = (a: number, up: number) => {
	const k = 1 / Math.hypot(1, up);
	return [Math.cos(a) * k, up * k, Math.sin(a) * k];
};

/** A trunk from the ground to `top`, `radius` wide at its foot. */
const trunk = (top: number, radius: number): Part => ({
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
function build(parts: Part[], level: number) {
	const out: Arrays = { positions: [], normals: [], uvs: [], colors: [] };
	const indices: number[] = [];
	for (const { at, grids } of parts) {
		const [columns, rows] = grids[level] as readonly [number, number];
		const start = out.positions.length / 3;
		for (let r = 0; r <= rows; r++)
			for (let c = 0; c <= columns; c++) {
				const [x, y, z, nx, ny, nz, tu, tv, shade] = at(c / columns, r / rows) as number[];
				out.positions.push(x as number, y as number, z as number);
				out.normals.push(nx as number, ny as number, nz as number);
				out.uvs.push(tu as number, tv as number);
				out.colors.push(shade as number, shade as number, shade as number);
				const i = start + r * (columns + 1) + c;
				if (r < rows && c < columns)
					indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
			}
	}
	return { ...out, indices };
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

/** A tree 1 high at each of its four levels: its arrays, and its error after the base level. */
export function treeLevels(kind: Kind) {
	const parts = 'tiers' in kind ? firParts(kind) : broadleafParts(kind);
	let last = 0;
	return [0, 1, 2, 3].map((level) => {
		last = level === 0 ? 0 : Math.max(error(parts, level), last * 1.25);
		return { arrays: build(parts, level), error: last };
	});
}

/**
 * A kind's costliest mesh, which names the three coarser ones with their errors. Every row of an
 * instance batch of this kind then picks its own level.
 */
export function meshOf(geometry: Geometry, kind: Kind) {
	const [base, ...coarser] = treeLevels(kind).map(({ arrays, error }) => ({
		mesh: geometry.fromArrays(arrays),
		error,
	}));
	base?.mesh.setLevels(coarser);
	return base?.mesh ?? geometry.box();
}

/** The widest a tree of this kind reaches from its trunk, and its outline at height y. */
const reach = (kind: Kind) => ('tiers' in kind ? kind.width : kind.width * 1.3);
function outline(kind: Kind, y: number, jag: number) {
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
 * bark; one branch of needles, its stem up the middle and its needles slanting out; clumps of leaves.
 */
export function woodTexture(size = 256) {
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
				const furrow = 0.5 + 0.5 * Math.sin(u * TURN * 7 + 1.8 * Math.sin(v * 40 + u * TURN * 2));
				rgb = [96, 78, 62].map((c) => c * (0.35 + 0.65 * furrow ** 1.5) * g);
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

/** The cut-out pictures of the trees for the far cards: one column each, 64 by 128 texels. */
export function cardTexture(kinds: readonly Kind[]) {
	const [w, h] = [64, 128];
	const width = w * kinds.length;
	const data = new Uint8Array(width * h * 4);
	kinds.forEach((kind, n) => {
		const fir = 'tiers' in kind;
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const [tx, ty] = [((x + 0.5) / w - 0.5) * 2 * reach(kind), (y + 0.5) / h];
				const jag = 0.5 + 0.5 * Math.sin(ty * 140 + n * 2 + (tx > 0 ? 1.3 : 0));
				const r = outline(kind, ty, jag);
				const bole = Math.abs(tx) < 0.02 && ty < (fir ? 0.95 : 0.6);
				const leaf = Math.abs(tx) < r;
				const lit = (0.55 + 0.45 * (r > 0 ? Math.abs(tx) / r : 0)) * (0.7 + 0.3 * ty);
				const foliage = fir ? [40, 70, 34] : [150, 172, 70];
				const rgb = leaf ? foliage.map((c) => c * lit) : bole ? [62, 50, 40] : foliage;
				data.set([...rgb, leaf || bole ? 255 : 0], (y * width + n * w + x) * 4);
			}
	});
	return { width, height: h, data };
}

/** A card for kind `n` of `count`: two crossed quads, as wide as the tree, 1 high. */
export function cardArrays(kind: Kind, n: number, count: number) {
	const out = { positions: [] as number[], normals: [] as number[], uvs: [] as number[] };
	const [w, u0, u1] = [reach(kind), n / count, (n + 1) / count];
	for (const a of [0, Math.PI / 2]) {
		const [dx, dz] = [Math.cos(a), Math.sin(a)];
		for (const [side, y] of [
			[-1, 0],
			[1, 0],
			[1, 1],
			[-1, 1],
		] as const) {
			out.positions.push(side * w * dx, y, side * w * dz);
			out.normals.push(...lean(side > 0 ? a : a + Math.PI, 0.8));
			out.uvs.push(side > 0 ? u1 : u0, y);
		}
	}
	return { ...out, indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] };
}

/** The land's height: rolling hills, which rise into ridges past the forest's edge. */
export function ground(x: number, z: number) {
	const hills = 9 * Math.sin(x * 0.011) * Math.cos(z * 0.013) + 4 * Math.sin((x + z) * 0.027);
	const a = Math.atan2(z, x);
	// The ridges stay low and near the forest's edge, their tops broken into tree-sized bumps.
	const ridge = 30 + 26 * Math.sin(a * 3 + 1) + 12 * Math.sin(a * 7 + 2) + 14 * Math.sin(x * 0.004);
	const tops = 4 * Math.sin(x * 0.07) * Math.cos(z * 0.062);
	return hills + smooth(520, 1600, Math.hypot(x, z)) * (ridge + tops);
}

/**
 * The land out to `far` meters, as rings that widen with distance, with texture coordinates every
 * 8 m. Its colors run from the needle litter of the forest floor to the dark canopy of the ridges.
 */
export function landArrays(far: number, edge: number) {
	const positions: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const [around, out] = [160, 120];
	for (let r = 0; r <= out; r++)
		for (let c = 0; c <= around; c++) {
			const [a, d] = [(c / around) * TURN, far * (r / out) ** 2];
			const [x, z] = [Math.cos(a) * d, Math.sin(a) * d];
			positions.push(x, ground(x, z), z);
			uvs.push(x / 8, z / 8);
			const wood = smooth(edge * 0.85, edge * 1.35, d);
			const patch = 0.82 + 0.18 * Math.sin(x * 0.03) * Math.sin(z * 0.025);
			// Needle litter under the trees, in the shade the canopy keeps over it, then a dark canopy
			// with tree-top bumps on the ridges.
			const tops = wood > 0 && d > edge ? 0.78 + 0.42 * Math.sin(x * 0.16) * Math.sin(z * 0.19) : 1;
			const shade = (near: number, far: number) => (near * (1 - wood) + far * wood) * patch * tops;
			colors.push(shade(0.19, 0.03), shade(0.155, 0.05), shade(0.085, 0.024));
			const i = r * (around + 1) + c;
			if (r < out && c < around)
				indices.push(i, i + around + 1, i + 1, i + 1, i + around + 1, i + around + 2);
		}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/** A mottled texture that repeats, for the land: litter and moss, made brighter to tint. */
export function litterTexture(size = 64) {
	math.seed(9);
	const data = new Uint8Array(size * size * 4).fill(255);
	for (let i = 0; i < size * size; i++) {
		const [x, y] = [(i % size) / size, Math.floor(i / size) / size];
		const mottle =
			0.5 + 0.25 * Math.sin(x * TURN * 3 + Math.sin(y * TURN * 2) * 2) * Math.sin(y * TURN * 4);
		const shade = Math.min(255, (150 + 95 * mottle) * math.randFloat(0.8, 1.1));
		data.set([shade, shade * 0.86, shade * 0.62, 255].map(Math.round), i * 4);
	}
	return { width: size, height: size, data };
}

/** The rows of every tree: kind, place, height, width, turn and tint, in rings from the middle out. */
export type Rows = {
	kind: Uint8Array;
	place: Float32Array;
	size: Float32Array;
	tint: Float32Array;
};

/** Heights in meters of each kind, from and to. */
const HEIGHTS = [
	[12, 21],
	[10, 16],
	[5, 9],
	[8, 13],
] as const;

/**
 * Scatters `count` trees over a disc `radius` meters out, the first rows nearest the middle, from
 * a fixed seed. Broadleaf trees gather in the hollows, young firs at the edge.
 */
export function plantRows(count: number, radius: number): Rows {
	math.seed(11);
	const rows: Rows = {
		kind: new Uint8Array(count),
		place: new Float32Array(count * 4),
		size: new Float32Array(count * 2),
		tint: new Float32Array(count * 4),
	};
	for (let k = 0; k < count; k++) {
		const out = Math.sqrt((k + 0.5) / count);
		const angle = k * 2.39996 + math.randFloat(-0.4, 0.4);
		const [u, v] = [Math.cos(angle) * out * radius, Math.sin(angle) * out * radius];
		// The spiral alone would read as a lattice of even gaps. A shift that varies slowly over the
		// wood gathers the trees into thickets and opens small clearings, and the jitter across both
		// axes breaks up what is left of the pattern.
		const [x, z] = [
			u + 11 * Math.sin(u * 0.045 + 1.7) * Math.cos(v * 0.039) + math.randFloat(-3.5, 3.5),
			v + 11 * Math.sin(v * 0.041 - 0.6) * Math.cos(u * 0.047 + 0.4) + math.randFloat(-3.5, 3.5),
		];
		const patch = 0.5 + 0.5 * Math.sin(x * 0.009 + 1.3) * Math.cos(z * 0.008 - 0.7);
		const pick = math.random();
		const hollow = smooth(4, -8, ground(x, z)) * patch;
		const kind =
			pick < 0.05 + 0.4 * hollow
				? 3
				: pick < 0.1 + 0.25 * smooth(0.75, 1, out)
					? 2
					: pick < 0.6 + 0.2 * patch
						? 0
						: 1;
		const [lo, hi] = HEIGHTS[kind] as readonly [number, number];
		rows.kind[k] = kind;
		rows.place.set([x, ground(x, z) - 0.3, z, math.randFloat(0, Math.PI)], k * 4);
		rows.size.set([math.randFloat(lo, hi), math.randFloat(0.85, 1.15)], k * 2);
		const b = math.randFloat(0.8, 1.15);
		const autumn = kind === 3 ? math.random() : 0;
		const tint =
			autumn > 0.65
				? [1, 0.62 + 0.25 * (autumn - 0.65) * 3, 0.2]
				: kind === 3
					? [0.5, 0.75, 0.38]
					: [b * math.randFloat(0.85, 1.1), b, b * math.randFloat(0.8, 1.05)];
		rows.tint.set([...tint, 1], k * 4);
	}
	return rows;
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

/** Heights in meters of the understory, from and to. */
const BUSH_HEIGHTS = [1.6, 4.5] as const;

/**
 * Scatters `count` bushes over a disc `radius` meters out, from a fixed seed. Every row is kind 0,
 * so one call fills the batch. The bushes are jittered across both axes, unlike the trees, so the
 * ground cover does not follow the trees' spiral.
 */
export function bushRows(count: number, radius: number): Rows {
	math.seed(29);
	const rows: Rows = {
		kind: new Uint8Array(count),
		place: new Float32Array(count * 4),
		size: new Float32Array(count * 2),
		tint: new Float32Array(count * 4),
	};
	for (let k = 0; k < count; k++) {
		const out = Math.sqrt((k + 0.5) / count);
		const angle = k * 2.39996 + math.randFloat(-0.3, 0.3);
		const [x, z] = [
			Math.cos(angle) * out * radius + math.randFloat(-3, 3),
			Math.sin(angle) * out * radius + math.randFloat(-3, 3),
		];
		const [lo, hi] = BUSH_HEIGHTS;
		rows.place.set([x, ground(x, z) - 0.15, z, math.randFloat(0, Math.PI)], k * 4);
		rows.size.set([math.randFloat(lo, hi), math.randFloat(0.8, 1.3)], k * 2);
		const b = math.randFloat(0.55, 0.9);
		const tint =
			math.random() > 0.78 ? [0.85, 0.6, 0.24] : [b * 0.95, b, b * 0.72 * math.randFloat(0.8, 1.2)];
		rows.tint.set([...tint, 1], k * 4);
	}
	return rows;
}

/** Writes the rows of one kind into a batch, skipping the first `skip` of them. */
export function fillRows(batch: InstanceBatch, rows: Rows, kind: number, skip = 0) {
	const { positions, rotations, scales, colors } = batch;
	let [seen, row] = [0, 0];
	for (let k = 0; k < rows.kind.length; k++) {
		if (rows.kind[k] !== kind || seen++ < skip) continue;
		const turn = rows.place[k * 4 + 3] as number;
		const [height, width] = [rows.size[k * 2] as number, rows.size[k * 2 + 1] as number];
		positions.set(rows.place.subarray(k * 4, k * 4 + 3), row * 3);
		rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], row * 4);
		scales.set([height * width, height, height * width], row * 3);
		colors?.set(rows.tint.subarray(k * 4, k * 4 + 4), row * 4);
		row++;
	}
	batch.markDirty(0, row);
	return row;
}

/** How many rows of each kind come before row `near`, and how many in all. */
export function countRows(rows: Rows, near: number) {
	const before = [0, 0, 0, 0];
	const all = [0, 0, 0, 0];
	rows.kind.forEach((kind, k) => {
		all[kind] = (all[kind] as number) + 1;
		if (k < near) before[kind] = (before[kind] as number) + 1;
	});
	return { before, all };
}

/** The four kinds: a tall narrow spruce, a fir, a young broad fir, and a broadleaf tree. */
export const KINDS: readonly Kind[] = [
	{ tiers: 7, low: 0.1, width: 0.225, branches: 8, droop: 0.3 },
	{ tiers: 5, low: 0.14, width: 0.3, branches: 10, droop: 0.2 },
	{ tiers: 4, low: 0.06, width: 0.4, branches: 6, droop: 0.35 },
	{ crown: 0.62, width: 0.3 },
];
