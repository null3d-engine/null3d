// The slots of a species' pools of real pieces. A slot holds one copy's shoot rows, placed in the
// world, in a pool whose row batches draw to the switch or on to the texel range; moving a slot to
// another copy rewrites its rows' places and its near-table texels, and builds no batch. Each pool
// is sized from the budget, the most copies the budget can grant at once, so a small budget holds
// little memory, and the two pools share the slots of the species' near table, the switch pool
// first.
import { NEAR_SLOTS } from './textures';

/** The slots a species' near table holds, which its two pools share. */
export const POOL_SLOTS = NEAR_SLOTS;

/** A slot that a pool gives to a copy, or frees with copy -1. */
export interface SlotMove {
	readonly slot: number;
	readonly copy: number;
}

/** The slots of one pool and the copies that hold them. */
export class SlotPool {
	/** The copy each slot holds, or -1. */
	readonly holders: Int32Array;
	/** The copies the last hand-out wanted that the pool had no slot for, in their order. */
	refused: number[] = [];

	constructor(size: number) {
		this.holders = new Int32Array(size).fill(-1);
	}

	/**
	 * Gives the pool's slots to the copies that want them, nearest first: as many as the pool holds,
	 * each copy that holds a slot keeping it, the others taking the free slots in order, and the
	 * copies past the pool's size refused.
	 *
	 * @param wanted The copies granted this pool's range, nearest first.
	 * @returns The slots that change hands.
	 */
	assign(wanted: readonly number[]): SlotMove[] {
		const kept = new Set(wanted.slice(0, this.holders.length));
		this.refused = wanted.slice(this.holders.length);
		const moves = new Map<number, number>();
		const held = new Set<number>();
		this.holders.forEach((copy, slot) => {
			if (copy < 0) return;
			if (kept.has(copy)) held.add(copy);
			else {
				this.holders[slot] = -1;
				moves.set(slot, -1);
			}
		});
		let free = 0;
		for (const copy of kept) {
			if (held.has(copy)) continue;
			while ((this.holders[free] as number) >= 0) free++;
			this.holders[free] = copy;
			moves.set(free, copy);
		}
		return [...moves.entries()].sort((a, b) => a[0] - b[0]).map(([slot, copy]) => ({ slot, copy }));
	}
}

/**
 * The sizes of a species' two pools from the scene's budget: the switch pool holds the most copies of
 * its cheapest variant the budget can grant at once to the switch, within the species' slots, and
 * the texel pool the most it can grant on to the texel range, within the slots left.
 *
 * @param costs Each variant's costs to the switch and to the texel range.
 * @param budget The scene's triangles for real pieces.
 * @returns The two sizes.
 */
export function poolSizes(
	costs: readonly { readonly toSwitch: number; readonly toTexel: number }[],
	budget: number,
): { readonly switch: number; readonly texel: number } {
	let leastSwitch = Number.POSITIVE_INFINITY;
	let leastTexel = Number.POSITIVE_INFINITY;
	for (const c of costs) {
		if (c.toSwitch > 0) leastSwitch = Math.min(leastSwitch, c.toSwitch);
		if (c.toTexel > c.toSwitch) leastTexel = Math.min(leastTexel, c.toTexel);
	}
	const toSwitch = Number.isFinite(leastSwitch) ? Math.floor(budget / leastSwitch) : 0;
	const switchSize = Math.min(POOL_SLOTS, toSwitch);
	const toTexel = Number.isFinite(leastTexel) ? Math.floor(budget / leastTexel) : 0;
	return { switch: switchSize, texel: Math.min(POOL_SLOTS - switchSize, toTexel) };
}
