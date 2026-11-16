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
import type { MacroSkeleton } from '../core/graph';

/**
 * The share of its sky-lit tone that a clump's lowest leaves keep: the clump's own leaves stand
 * over its underside, so its foot reads dark and its top reads open to the sky.
 */
export const CLUMP_UNDER_SHADE = 0.35;

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
	const at = rows.socket;
	if (!sockets || !at || rows.count <= 1) return undefined;
	const byLobe = new Map<number, number[]>();
	for (let r = 0; r < rows.count; r++) {
		const socket = at[r] as number;
		if (socket >= sockets.lobe.length) continue;
		const lobe = sockets.lobe[socket] as number;
		const list = byLobe.get(lobe);
		if (list) list.push(r);
		else byLobe.set(lobe, [r]);
	}
	if (byLobe.size < 2 || byLobe.size === rows.count) return undefined;
	const clumps: Clump[] = [];
	for (const [lobe, list] of byLobe) {
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
	const keep = CLUMP_UNDER_SHADE + (1 - CLUMP_UNDER_SHADE) * rise(t);
	return Math.max(0, Math.min(1, clump.sky * keep));
}
