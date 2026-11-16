// The clump card: the crown's foliage drawn as one card set for each clump of sockets, so a clump
// reads as a lit top over a dark underside rather than as many shoot cards lit one by one. A shoot
// card carries its own leaves' normals and lights each picture afresh; a clump card carries the
// clump's own shade, baked once from the clump's sky share and its height inside the clump, so the
// crown's depth holds at every sun angle.
//
// The clump is the foliage mass that the sockets carry as their lobe. Its rows are the raw material
// of a card cluster (see `cardClusters` in ./cards); this module groups them and gives each group
// the shade that its card bakes.
import type { ShootRows } from '../asset';
import type { MacroSkeleton, SocketSites } from '../core/graph';

/**
 * The shares of its own open sky that a clump card wears at its foot and at its top: the clump's own
 * leaves stand over its underside, so its foot reads dark and its top reads open to the sky. The two
 * average about one, so the card keeps the clump's own mean tone while it gains its depth.
 */
export const CLUMP_UNDER_SHADE = 0.8;
export const CLUMP_OVER_SHADE = 1.2;

/** One foliage mass of a plant, and the rows that stand in it. */
export interface Clump {
	/** The mass's id, which its sockets carry as their lobe. */
	readonly lobe: number;
	/** Its rows, in the plant's space-filling order. */
	readonly rows: readonly number[];
	/** The mean height of its rows' places, in metres. */
	readonly middle: number;
	/**
	 * How far its rows stand from that height, as the root of their mean square: the half-height of
	 * the band that the card's shade runs over.
	 */
	readonly spread: number;
	/** The mean sky visibility of its rows, 0 to 1. */
	readonly sky: number;
}

/** The plant a clump is read from: its rows and the skeleton their sockets stand on. */
export interface ClumpPlant {
	readonly rows: ShootRows;
	readonly skeleton: MacroSkeleton;
}

/**
 * The clumps of a plant, each with the rows that stand in it.
 *
 * A plant whose rows name no socket, or whose every row stands in a clump of its own, gives
 * undefined: a clump card then draws what a shoot card draws, and the caller keeps its own cards.
 *
 * @param plant The plant.
 * @returns One clump per foliage mass, in the order their lowest-ordered row meets the walk.
 * @category api/vegetation
 */
export function clumpsOf(plant: ClumpPlant): Clump[] | undefined {
	const { rows, skeleton } = plant;
	const sockets = skeleton.buds.sockets;
	if (rows.count <= 1) return undefined;
	const groups = new Map<number, number[]>();
	// A plant whose sockets share a foliage mass names it with their lobe. A plant that gives each
	// socket a mass of its own, as the frame's twigs do, has no clump to read, and its rows group by
	// the branch that carries them instead.
	const lobes = socketLobes(rows, sockets);
	if (lobes) {
		for (let r = 0; r < rows.count; r++) {
			const lobe = lobes(r);
			const list = groups.get(lobe);
			if (list) list.push(r);
			else groups.set(lobe, [r]);
		}
		if (groups.size < 2 || groups.size === rows.count) groups.clear();
	}
	if (groups.size === 0) {
		const byBranch = branchGroups(rows, skeleton);
		if (!byBranch) return undefined;
		for (const [branch, list] of byBranch) groups.set(branch, list);
	}
	const clumps: Clump[] = [];
	for (const [lobe, list] of groups) {
		list.sort((a, b) => (rows.order[a] as number) - (rows.order[b] as number) || a - b);
		let middle = 0;
		let sky = 0;
		for (const r of list) {
			middle += (rows.position[r * 3 + 1] as number) / list.length;
			sky += (rows.sky[r] as number) / (255 * list.length);
		}
		let squared = 0;
		for (const r of list) squared += ((rows.position[r * 3 + 1] as number) - middle) ** 2 / list.length;
		clumps.push({ lobe, rows: list, middle, spread: Math.sqrt(squared), sky });
	}
	// The walk meets the clumps in the order of their lowest-ordered row, so a cut between two runs
	// of `cardClusters` falls between two clumps.
	clumps.sort(
		(a, b) => (rows.order[a.rows[0] as number] as number) - (rows.order[b.rows[0] as number] as number),
	);
	return clumps;
}

/** The fewest shoot rows a branch carries before it stands for a clump on a plant without clumps. */
export const CLUMP_ROWS_LEAST = 8;

/**
 * The foliage mass that each row's socket names, where the plant's sockets share them; undefined
 * where every socket names a mass of its own.
 */
function socketLobes(rows: ShootRows, sockets: SocketSites | undefined): ((row: number) => number) | undefined {
	const at = rows.socket;
	if (!sockets || !at) return undefined;
	const used = new Set<number>();
	const named = new Set<number>();
	for (let r = 0; r < rows.count; r++) {
		const socket = at[r] as number;
		if (socket >= sockets.lobe.length) continue;
		used.add(socket);
		named.add(sockets.lobe[socket] as number);
	}
	if (named.size < 2 || named.size === used.size) return undefined;
	return (row: number): number => sockets.lobe[at[row] as number] as number;
}

/**
 * The rows of a plant that names no foliage mass, grouped by the branch that carries them: each
 * row's own axis, climbed until it stands for a clump's worth of shoots. This is a stand-in for the
 * clump a plant without clumps does not state, so a picture drawn with it says so.
 */
function branchGroups(
	rows: ShootRows,
	skeleton: MacroSkeleton,
): Map<number, number[]> | undefined {
	const { axisOf } = skeleton;
	const at = rows.node;
	if (!at) return undefined;
	const parent = skeleton.axes.parent;
	const own = new Uint32Array(rows.count);
	// The rows under each axis, counted up the tree, so a climb knows when it has reached a clump.
	const under = new Map<number, number>();
	for (let r = 0; r < rows.count; r++) {
		const axis = axisOf[at[r] as number] as number;
		own[r] = axis;
		for (let up: number = axis; up >= 0; up = parent[up] as number) {
			under.set(up, (under.get(up) ?? 0) + 1);
			if (parent[up] === up) break;
		}
	}
	const chosen = new Map<number, number>();
	const groups = new Map<number, number[]>();
	for (let r = 0; r < rows.count; r++) {
		let axis = own[r] as number;
		let kept = chosen.get(axis);
		if (kept === undefined) {
			while ((under.get(axis) ?? 0) < CLUMP_ROWS_LEAST) {
				const up = parent[axis] as number;
				if (up < 0 || up === axis) break;
				axis = up;
			}
			kept = axis;
			chosen.set(own[r] as number, kept);
		}
		const list = groups.get(kept);
		if (list) list.push(r);
		else groups.set(kept, [r]);
	}
	return groups.size >= 2 ? groups : undefined;
}

/**
 * The rows of some clumps in one walk, each clump's run kept whole, for `cardClusters` to cut into
 * one card set per clump.
 *
 * @param clumps The clumps.
 * @returns The rows, in the order the walk meets them.
 * @category api/vegetation
 */
export function clumpWalk(clumps: readonly Clump[]): Uint32Array {
	let count = 0;
	for (const clump of clumps) count += clump.rows.length;
	const walk = new Uint32Array(count);
	let at = 0;
	for (const clump of clumps) for (const row of clump.rows) walk[at++] = row;
	return walk;
}

/** A smooth step from 0 to 1 over a band from -1 to 1, flat at both ends. */
function rise(t: number): number {
	const x = Math.max(0, Math.min(1, (t + 1) / 2));
	return x * x * (3 - 2 * x);
}

/**
 * The sky share that a clump card's vertex carries at a height: the clump's own open sky, lowered
 * toward the dark underside below the clump's middle and kept whole above it. The shade is baked
 * into the card's own sky byte, so the card role's lighting reads it as the clump's occlusion.
 *
 * @param clump The clump.
 * @param height The vertex's height, in metres.
 * @returns The share, 0 to 1.
 * @category api/vegetation
 */
export function clumpSky(clump: Clump, height: number): number {
	const t = clump.spread > 1e-6 ? (height - clump.middle) / clump.spread : 1;
	const up = rise(t);
	const keep = CLUMP_UNDER_SHADE + (CLUMP_OVER_SHADE - CLUMP_UNDER_SHADE) * up;
	return Math.max(0, Math.min(1, clump.sky * keep));
}
