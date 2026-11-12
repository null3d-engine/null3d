// The connected body of one mesh level: its drawn wood from the root, and the cards joined to it. A
// level thins the wood by its orders and the cards by their share; every card whose branch went is
// dropped, so the level's plant is one body reaching the root.
import { AXIS_LIMB, AXIS_STEM, AXIS_STIPE } from '../core/graph';
import type { MeshInput, MeshLevel } from '../stages';
import { connectedCards } from './cards';

/** One level's plant: its connected components, and whether the stem's root is one of them. */
export interface ConnectedBody {
	/** The components of the drawn wood, from its roots. The drawn cards are joined by rule. */
	readonly components: number;
	/** Whether a stem of the plant is drawn at this level, so the body reaches the root. */
	readonly reachesRoot: boolean;
	/** The cards or shoots the level draws, all joined to the body. */
	readonly cards: number;
}

/**
 * Counts a level's connected body: its drawn wood is one component per root, and every drawn card is
 * joined to it by the card rule, so a card whose branch went is not drawn.
 *
 * @param input The dressed variant.
 * @param level The mesh level.
 * @returns The level's components, root and drawn cards.
 * @category api/vegetation
 */
export function connectedBody(input: MeshInput, level: MeshLevel): ConnectedBody {
	const { axes } = input.skeleton;
	const keep = level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
	let components = 0;
	let reachesRoot = false;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) > keep) continue;
		const parent = axes.parent[a] as number;
		const kind = axes.kind[a] as number;
		const wood = parent >= 0 || kind === AXIS_STEM || kind === AXIS_STIPE || kind === AXIS_LIMB;
		if (!wood) continue;
		if (parent < 0) components++;
		if (kind === AXIS_STEM && (axes.order[a] as number) === 0) reachesRoot = true;
	}
	let cards = 0;
	if (level > 0) {
		const flags = connectedCards(input, level as 1 | 2);
		for (let r = 0; r < flags.length; r++) if (flags[r] === 1) cards++;
	}
	return { components, reachesRoot, cards };
}

/** How far a vertex may lie from a triangle's surface and still weld to it, in metres. */
const WELD_REACH = 0.001;

/** The width of the buckets that hold triangles for the weld search, in metres. */
const WELD_CELL = 0.1;

/**
 * The distance from a point to the nearest point of a triangle, in metres.
 *
 * @param px The point's x.
 * @param py The point's y.
 * @param pz The point's z.
 * @param ax The first corner's x.
 * @param ay The first corner's y.
 * @param az The first corner's z.
 * @param bx The second corner's x.
 * @param by The second corner's y.
 * @param bz The second corner's z.
 * @param cx The third corner's x.
 * @param cy The third corner's y.
 * @param cz The third corner's z.
 * @returns The distance.
 */
function pointToTriangle(
	px: number,
	py: number,
	pz: number,
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
	cx: number,
	cy: number,
	cz: number,
): number {
	const abx = bx - ax,
		aby = by - ay,
		abz = bz - az;
	const acx = cx - ax,
		acy = cy - ay,
		acz = cz - az;
	const apx = px - ax,
		apy = py - ay,
		apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
	const bpx = px - bx,
		bpy = py - by,
		bpz = pz - bz;
	const d3 = abx * bpx + aby * bpy + abz * bpz;
	const d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		return Math.hypot(px - (ax + abx * v), py - (ay + aby * v), pz - (az + abz * v));
	}
	const cpx = px - cx,
		cpy = py - cy,
		cpz = pz - cz;
	const d5 = abx * cpx + aby * cpy + abz * cpz;
	const d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		return Math.hypot(px - (ax + acx * w), py - (ay + acy * w), pz - (az + acz * w));
	}
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return Math.hypot(
			px - (bx + (cx - bx) * w),
			py - (by + (cy - by) * w),
			pz - (bz + (cz - bz) * w),
		);
	}
	const den = 1 / (va + vb + vc);
	const v = vb * den;
	const w = vc * den;
	return Math.hypot(
		px - (ax + abx * v + acx * w),
		py - (ay + aby * v + acy * w),
		pz - (az + abz * v + acz * w),
	);
}

/**
 * The connected components of a mesh's triangles. Vertices at the same place (to a tenth of a
 * millimetre) are welded, and triangles that share a welded vertex join. A branch tube meets its
 * parent by laying its first ring on the parent's surface, so the two share no vertices; a vertex
 * that lies on a triangle within a millimetre therefore welds to it, and the seam counts as the one
 * surface a player sees. A plant drawn as one body has one component, and a piece that hangs free
 * has its own.
 *
 * @param mesh The mesh's positions and triangle indices.
 * @returns The number of components.
 * @category api/vegetation
 */
export function geometryComponents(mesh: {
	readonly positions: ArrayLike<number>;
	readonly indices: ArrayLike<number>;
}): number {
	const count = mesh.positions.length / 3;
	const triangles = mesh.indices.length / 3;
	const parent = new Int32Array(count);
	for (let i = 0; i < count; i++) parent[i] = i;
	const find = (i: number): number => {
		let root = i;
		while ((parent[root] as number) !== root) root = parent[root] as number;
		while ((parent[i] as number) !== root) {
			const next = parent[i] as number;
			parent[i] = root;
			i = next;
		}
		return root;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[rb] = ra;
	};
	const p = mesh.positions;
	const welded = new Map<string, number>();
	for (let i = 0; i < count; i++) {
		const key = `${Math.round((p[i * 3] as number) * 1e4)},${Math.round((p[i * 3 + 1] as number) * 1e4)},${Math.round((p[i * 3 + 2] as number) * 1e4)}`;
		const first = welded.get(key);
		if (first === undefined) welded.set(key, i);
		else union(first, i);
	}
	for (let t = 0; t < mesh.indices.length; t += 3) {
		const a = mesh.indices[t] as number;
		const b = mesh.indices[t + 1] as number;
		const c = mesh.indices[t + 2] as number;
		union(a, b);
		union(b, c);
	}
	// Triangles by the cells of their box, since a seam's vertex can lie on the middle of a long
	// triangle whose own corners stand far from it.
	const bucket = new Map<string, number[]>();
	const at = (i: number, j: number, k: number) => `${i},${j},${k}`;
	const cellOf = (v: number) =>
		[
			Math.floor((p[v * 3] as number) / WELD_CELL),
			Math.floor((p[v * 3 + 1] as number) / WELD_CELL),
			Math.floor((p[v * 3 + 2] as number) / WELD_CELL),
		] as const;
	for (let t = 0; t < triangles; t++) {
		const corners = [0, 1, 2].map((n) => mesh.indices[t * 3 + n] as number);
		const low = [0, 1, 2].map((axis) =>
			Math.floor(Math.min(...corners.map((v) => p[v * 3 + axis] as number)) / WELD_CELL),
		);
		const high = [0, 1, 2].map((axis) =>
			Math.floor(Math.max(...corners.map((v) => p[v * 3 + axis] as number)) / WELD_CELL),
		);
		for (let i = low[0] as number; i <= (high[0] as number); i++)
			for (let j = low[1] as number; j <= (high[1] as number); j++)
				for (let k = low[2] as number; k <= (high[2] as number); k++) {
					const key = at(i, j, k);
					const list = bucket.get(key);
					if (list === undefined) bucket.set(key, [t]);
					else if (list[list.length - 1] !== t) list.push(t);
				}
	}
	for (let v = 0; v < count; v++) {
		const point = [p[v * 3] as number, p[v * 3 + 1] as number, p[v * 3 + 2] as number];
		const [ci, cj, ck] = cellOf(v);
		for (let di = -1; di <= 1; di++)
			for (let dj = -1; dj <= 1; dj++)
				for (let dk = -1; dk <= 1; dk++) {
					const list = bucket.get(at(ci + di, cj + dj, ck + dk));
					if (list === undefined) continue;
					for (const t of list) {
						const a = mesh.indices[t * 3] as number;
						if (find(a) === find(v)) continue;
						const b = mesh.indices[t * 3 + 1] as number;
						const c = mesh.indices[t * 3 + 2] as number;
						if (
							pointToTriangle(
								point[0] as number,
								point[1] as number,
								point[2] as number,
								p[a * 3] as number,
								p[a * 3 + 1] as number,
								p[a * 3 + 2] as number,
								p[b * 3] as number,
								p[b * 3 + 1] as number,
								p[b * 3 + 2] as number,
								p[c * 3] as number,
								p[c * 3 + 1] as number,
								p[c * 3 + 2] as number,
							) <= WELD_REACH
						)
							union(v, a);
					}
				}
	}
	const roots = new Set<number>();
	for (let t = 0; t < mesh.indices.length; t += 3) roots.add(find(mesh.indices[t] as number));
	return roots.size;
}
