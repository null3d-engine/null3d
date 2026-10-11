// Pines made in code at four levels of detail, and the rolling hills they stand on, for the forest
// demo and the test page that measures what the levels save. A pine is a trunk and four tiers of
// needles, each a curved cone whose edge waves three times around it, in vertex colors, darker
// toward each tier's base.
import { type Geometry, type InstanceBatch, type MeshGeometry, math } from '@null3d/engine';

/**
 * Each level's segments around a tier of needles, its rings from the tier's base to its tip, and
 * its error for a tree 1 high: the farthest that its widest tier strays from the true curve, which
 * a script measured once, at 720 points around the tier and up its side. The base level has 6,400
 * triangles, and the coarsest 40.
 */
export const PINE_LEVELS: readonly (readonly [number, number, number])[] = [
	[40, 16, 0],
	[18, 7, 0.0102],
	[9, 3, 0.0361],
	[4, 1, 0.1368],
];
/** The trunk, then the tiers of needles of a tree 1 high: base height, radius, height, color. */
type Part = readonly [number, number, number, readonly number[]];
const PARTS: readonly Part[] = [
	[0, 0.035, 0.3, [0.16, 0.09, 0.05]],
	...[0.34, 0.27, 0.2, 0.12].map(
		(radius, k): Part => [0.12 + k * 0.2, radius, 0.5 - k * 0.07, [0.05, 0.17, 0.08]],
	),
];
const TURN = Math.PI * 2;

/** The hills' height at a point. */
export const ground = (x: number, z: number) =>
	9 * Math.sin(x * 0.011) * Math.cos(z * 0.013) + 4 * Math.sin((x + z) * 0.027);
/** A tier's radius at height `h` from its base to its tip, and angle `a`: curved, in three waves. */
const edge = (radius: number, h: number, a: number) =>
	radius * (1 - h) ** 1.5 * (1 + 0.1 * Math.sin(a * 3));

type Arrays = { positions: number[]; colors: number[]; indices: number[] };
/** Adds `columns` by `rows` quads to `out`, with each vertex's position and color from `at`. */
function grid(out: Arrays, columns: number, rows: number, at: (u: number, v: number) => number[]) {
	const start = out.positions.length / 3;
	for (let r = 0; r <= rows; r++)
		for (let c = 0; c <= columns; c++) {
			const [x, y, z, ...color] = at(c / columns, r / rows);
			out.positions.push(x as number, y as number, z as number);
			out.colors.push(...color);
			const a = start + r * (columns + 1) + c;
			if (r < rows && c < columns)
				out.indices.push(a, a + columns + 1, a + 1, a + 1, a + columns + 1, a + columns + 2);
		}
	return out;
}

/** A pine 1 high at the level of `segments` and `rings`, with its vertex colors. */
function pine(segments: number, rings: number) {
	const out: Arrays = { positions: [], colors: [], indices: [] };
	for (const [y, radius, height, color] of PARTS)
		grid(out, segments, rings, (u, h) => {
			const [a, shade] = [u * TURN, 0.65 + 0.35 * h];
			const e = edge(radius, h, a);
			return [Math.cos(a) * e, y + height * h, Math.sin(a) * e, ...color.map((c) => c * shade)];
		});
	return { ...out, computeNormals: true };
}

/** A pine 1 high whose base mesh names its three coarser levels, each with its error. */
export function pineWithLevels(geometry: Geometry): MeshGeometry {
	const [full, ...coarser] = PINE_LEVELS.map(([segments, rings]) =>
		geometry.fromArrays(pine(segments, rings)),
	);
	const base = full as MeshGeometry;
	base.setLevels(coarser.map((mesh, k) => ({ mesh, error: PINE_LEVELS[k + 1]?.[2] ?? 1 })));
	return base;
}

/** Hills `side` meters across, as a grid whose heights follow `ground`, in grass colors. */
export function hills(geometry: Geometry, side: number): MeshGeometry {
	const out = grid({ positions: [], colors: [], indices: [] }, 160, 160, (u, v) => {
		const [x, z] = [(u - 0.5) * side, (v - 0.5) * side];
		const shade = 0.75 + 0.25 * Math.sin(x * 0.05) * Math.sin(z * 0.04);
		return [x, ground(x, z), z, 0.16 * shade, 0.2 * shade, 0.08 * shade];
	});
	return geometry.fromArrays({ ...out, computeNormals: true });
}

/**
 * Scatters a batch's rows over the hills in a disc `side` meters across, the first rows nearest
 * the middle, each tree from 9 to 17 m tall and turned its own way, from a fixed seed.
 */
export function plantPines(batch: InstanceBatch, count: number, side: number): void {
	math.seed(11);
	const { positions, rotations, scales } = batch;
	for (let k = 0; k < count; k++) {
		const reach = Math.sqrt((k + 0.5) / count) * side * 0.5;
		const angle = k * 2.39996 + math.randFloat(-0.4, 0.4);
		const [x, z] = [Math.cos(angle) * reach + math.randFloat(-3, 3), Math.sin(angle) * reach];
		positions.set([x, ground(x, z) - 0.3, z], k * 3);
		const turn = math.randFloat(0, Math.PI);
		rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], k * 4);
		scales.fill(math.randFloat(9, 17), k * 3, k * 3 + 3);
	}
	batch.markDirty(0, count);
}
