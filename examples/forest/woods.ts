// The forest's land and the parts of its trees that only the forest draws. Three firs and a broadleaf
// tree come from the shared generator (../lib/trees.ts) at four levels of detail, and a low
// understory of bushes covers the ground between the trunks, in the same four levels. A texture
// holds a cut-out picture of each tree for the far cards. The hills rise into wooded ridges.
//
// The trees are made in code, and the cost is measured rather than assumed. At the demo's own count
// of 8,000 near trees their coarsest levels are 62, 56 and 30 triangles for the three firs and 36
// for the broadleaf, so the whole stand costs between 240,000 and 496,000 triangles whatever the
// mix. The vegetation add-on's conifer is 3,079 triangles at its coarsest level, as the demo task's
// evidence records it, so the same 8,000 through the add-on draw 24,600,000, fifty to a hundred times
// as many. The demo does not load the add-on at all today, so the switch would also bring its wasm
// and its memory with it; the neighbouring demo measured that at 248.8 MiB against 51.8. A generator
// that costs a fiftieth of the triangles and none of the bytes is the demo's own.
import {
	type InstanceBatch,
	type Material,
	type Mesh,
	type MeshGeometry,
	math,
	type Scene,
} from '@null3d/engine';
import { ringLandArrays } from '../lib/land';
import { type Kind, lean, outline, reach, smooth, TURN } from '../lib/trees';

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
 * The land out to `far` meters, with texture coordinates every 8 m. Its colors run from the needle
 * litter of the forest floor to the dark canopy of the ridges.
 */
export function landArrays(far: number, edge: number) {
	return ringLandArrays({
		far,
		rings: 120,
		around: 160,
		spacing: 2,
		tile: 8,
		height: ground,
		color: (x, z, d) => {
			const wood = smooth(edge * 0.85, edge * 1.35, d);
			const patch = 0.82 + 0.18 * Math.sin(x * 0.03) * Math.sin(z * 0.025);
			// Needle litter under the trees, in the shade the canopy keeps over it, then a dark
			// canopy with tree-top bumps on the ridges.
			const tops = wood > 0 && d > edge ? 0.78 + 0.42 * Math.sin(x * 0.16) * Math.sin(z * 0.19) : 1;
			const shade = (near: number, far: number) => (near * (1 - wood) + far * wood) * patch * tops;
			return [shade(0.19, 0.03), shade(0.155, 0.05), shade(0.085, 0.024)];
		},
	});
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

/** The forest's counts for a preset: the near trees in full and the rest as cards on Low. */
export function fitCounts(
	kinds: readonly { trees: InstanceBatch; cards: InstanceBatch; count: number; near: number }[],
	undergrowth: InstanceBatch,
	low: boolean,
	bushes: { all: number; near: number },
): void {
	for (const { trees, cards, count, near } of kinds) {
		trees.setActiveCount(low ? near : count);
		cards.setActiveCount(low ? count - near : 0);
	}
	undergrowth.setActiveCount(low ? bushes.near : bushes.all);
}

/**
 * One hero fir beside the flight: an object rather than an instance row, whose bias keeps its finer
 * levels at a distance where the trees around it turn coarse. `setBias` toggles it for comparison.
 */
export function addHero(
	scene: Scene,
	kind: { mesh: MeshGeometry },
	material: Material,
	ground: (x: number, z: number) => number,
) {
	const mesh: Mesh = scene.createMesh({
		mesh: kind.mesh,
		material,
		position: [30, ground(30, 150), 150],
		scale: [8, 8, 8],
		castShadows: true,
		receiveShadows: true,
	});
	let keen = true;
	mesh.setLevelBias(0.25);
	return {
		setLevelBias: mesh.setLevelBias.bind(mesh),
		setBias() {
			keen = !keen;
			mesh.setLevelBias(keen ? 0.25 : 1);
			return keen;
		},
	};
}
