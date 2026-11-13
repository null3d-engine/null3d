// The slots of a species' pools of real pieces. A slot holds one copy's shoot rows, placed in the
// world, in a pool whose row batches draw to the switch or on to the texel range; moving a slot to
// another copy rewrites its rows' places and its near-table texels, and builds no batch. Each pool
// is sized from the budget, the most copies the budget can grant at once, so a small budget holds
// little memory, and the two pools share the slots of the species' near table, the switch pool
// first.
import { NEAR_SLOTS } from './textures';

/** The slots a species' near table holds, which its two pools share. */
export const POOL_SLOTS = NEAR_SLOTS;

/** Seconds a copy's pieces take to fade in or out as its grant changes. */
export const FADE_SECONDS = 0.25;

/**
 * What a pool does with a slot: gives it to a copy, takes it from a copy whose rows then fade out,
 * frees it once they have faded, or gives it back to the copy that was leaving it.
 */
export type SlotMoveKind = 'take' | 'leave' | 'free' | 'return';

/** A slot that changes hands, and the copy it goes to or comes from (-1 for a freed slot). */
export interface SlotMove {
	readonly slot: number;
	readonly copy: number;
	readonly kind: SlotMoveKind;
}

/** The slots of one pool and the copies that hold them. */
export class SlotPool {
	/** The copy each slot holds, or -1. */
	readonly holders: Int32Array;
	/** The copy whose rows each slot keeps while they fade out, or -1. */
	readonly leaving: Int32Array;
	/** When each leaving slot's rows have faded out, in seconds. */
	readonly until: Float64Array;
	/** The copies the last hand-out wanted that the pool had no slot for, in their order. */
	refused: number[] = [];

	constructor(size: number) {
		this.holders = new Int32Array(size).fill(-1);
		this.leaving = new Int32Array(size).fill(-1);
		this.until = new Float64Array(size);
	}

	/**
	 * Gives the pool's slots to the copies that want them, nearest first: as many as the pool holds,
	 * each copy that holds a slot keeping it, a copy leaving a slot taking it back, the others taking
	 * the free slots in order; a slot whose holder no longer wants it keeps that copy's rows fading
	 * out until the fade ends, and only then frees.
	 *
	 * @param wanted The copies granted this pool's range, nearest first.
	 * @param now The time in seconds.
	 * @returns The slots that change hands, in the order they do.
	 */
	assign(wanted: readonly number[], now: number): SlotMove[] {
		const moves: SlotMove[] = [];
		const size = this.holders.length;
		for (let slot = 0; slot < size; slot++)
			if ((this.leaving[slot] as number) >= 0 && now >= (this.until[slot] as number)) {
				this.leaving[slot] = -1;
				moves.push({ slot, copy: -1, kind: 'free' });
			}
		const kept = wanted.slice(0, size);
		this.refused = wanted.slice(size);
		const keep = new Set(kept);
		const held = new Set<number>();
		for (let slot = 0; slot < size; slot++) {
			const copy = this.holders[slot] as number;
			if (copy < 0) continue;
			if (keep.has(copy)) held.add(copy);
			else {
				this.holders[slot] = -1;
				this.leaving[slot] = copy;
				this.until[slot] = now + FADE_SECONDS;
				moves.push({ slot, copy, kind: 'leave' });
			}
		}
		for (const copy of kept) {
			if (held.has(copy)) continue;
			const back = this.leaving.indexOf(copy);
			if (back >= 0) {
				this.leaving[back] = -1;
				this.holders[back] = copy;
				moves.push({ slot: back, copy, kind: 'return' });
				continue;
			}
			let free = -1;
			for (let slot = 0; slot < size && free < 0; slot++)
				if ((this.holders[slot] as number) < 0 && (this.leaving[slot] as number) < 0) free = slot;
			if (free < 0) {
				this.refused.push(copy);
				continue;
			}
			this.holders[free] = copy;
			moves.push({ slot: free, copy, kind: 'take' });
		}
		return moves;
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
