// Stage 4 of the shared pipeline (D-377): close the kept pieces onto drawn wood. A kept socket's
// piece is drawn only where the axis it stands on is drawn, so the pass draws the carrier chain
// from the nearest axis the level already draws down to the socket's own carrier, each axis at
// its coarsest own segment count, and prices what it adds. A socket whose chain the level cannot
// pay for is dropped with its reason. The scope is every drawn piece: a leaf, a card and an extra
// close by the same rule, so a hap hanging on open sky fails exactly as a leaf does.
//
// The pass runs between grow and allocate: its price enters the plan before the allowance, so the
// cap accounts for the carriers it adds.
import type { MacroSkeleton } from '../core/graph';

/** The sockets a level keeps, and the carriers their pieces hang on. */
export interface CloseSockets {
	/** The number of sockets. */
	readonly count: number;
	/** The axis each socket's piece hangs on. */
	readonly carrierAxis: Uint32Array;
	/** Whether the grow stage kept the socket. */
	readonly kept: Uint8Array;
}

/** What the close pass did. */
export interface CarrierClose {
	/** The axes the pass drew, each with the triangles it costs at its coarsest segments. */
	readonly raised: readonly { readonly axis: number; readonly triangles: number }[];
	/** The kept sockets dropped, and why. */
	readonly dropped: readonly {
		readonly socket: number;
		readonly axis: number;
		readonly reason: string;
	}[];
	/** The triangles the raised carriers add to the price. */
	readonly price: number;
}

/** A function for the triangles one axis's wood costs at its coarsest own segment count. */
export type CoarsestCost = (axis: number) => number;

/**
 * Closes every kept socket onto drawn wood.
 *
 * @param skeleton The grown skeleton, whose axes state their parents and orders.
 * @param sockets The kept sockets and their carriers.
 * @param drawn Whether the level draws each axis's wood after the cap's allowance. The pass reads
 *   it and returns the axes it adds; it changes no input.
 * @param coarsest The triangles an axis's wood costs at its coarsest own segment count.
 * @param allowance The wood triangles the level has left, or undefined when it is unbounded. The
 *   pass pays the raised carriers from it in socket order and drops a socket whose chain it
 *   cannot pay.
 * @returns What the pass drew, what it dropped and the price it adds.
 */
export function closeCarriers(
	skeleton: Pick<MacroSkeleton, 'axes'>,
	sockets: CloseSockets,
	drawn: Uint8Array,
	coarsest: CoarsestCost,
	allowance?: number,
): CarrierClose {
	const { axes } = skeleton;
	const isDrawn = Uint8Array.from(drawn);
	const raised = new Map<number, number>();
	const dropped: CarrierClose['dropped'][number][] = [];
	let left = allowance ?? Number.POSITIVE_INFINITY;
	for (let socket = 0; socket < sockets.count; socket++) {
		if (sockets.kept[socket] !== 1) continue;
		const carrier = sockets.carrierAxis[socket] as number;
		if (isDrawn[carrier] === 1) continue;
		// The chain from the carrier up to the nearest axis the level draws. Every undrawn axis on
		// it is drawn at its coarsest own segments, so the carrier joins the drawn wood.
		const chain: number[] = [];
		let at = carrier;
		let joined = false;
		for (let steps = 0; steps <= axes.count; steps++) {
			if (isDrawn[at] === 1) {
				joined = true;
				break;
			}
			chain.push(at);
			const parent = axes.parent[at] as number;
			if (parent < 0) break;
			at = parent;
		}
		if (!joined) {
			dropped.push({
				socket,
				axis: carrier,
				reason: 'no drawn ancestor: the carrier chain reaches no drawn wood',
			});
			continue;
		}
		let price = 0;
		for (const axis of chain) if (!raised.has(axis)) price += coarsest(axis);
		if (price > left) {
			dropped.push({
				socket,
				axis: carrier,
				reason: `the carrier chain costs ${price} triangles and the allowance leaves ${left}`,
			});
			continue;
		}
		left -= price;
		for (const axis of chain) {
			if (raised.has(axis)) continue;
			raised.set(axis, coarsest(axis));
			isDrawn[axis] = 1;
		}
	}
	const list = [...raised.entries()]
		.map(([axis, triangles]) => ({ axis, triangles }))
		.sort((a, b) => a.axis - b.axis);
	return {
		raised: list,
		dropped,
		price: list.reduce((sum, entry) => sum + entry.triangles, 0),
	};
}
