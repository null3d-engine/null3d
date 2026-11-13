// The slots of a pool of real pieces: a copy that keeps its grant keeps its slot, a new grant takes a
// free slot nearest copy first, a copy that loses its grant leaves its slot, which keeps its rows
// fading out for the fade's length before another copy may take it, and a full pool turns the
// farther copies away. Each pool is sized from the budget: the most copies it can grant at once.
import { describe, expect, it } from 'bun:test';
import { FADE_SECONDS, POOL_SLOTS, poolSizes, SlotPool } from './near-slots';

describe('the slots of a pool of real pieces', () => {
	it('keeps a holder in its slot and gives a newcomer a free one', () => {
		const pool = new SlotPool(3);
		expect(pool.assign([4, 9], 0)).toEqual([
			{ slot: 0, copy: 4, kind: 'take' },
			{ slot: 1, copy: 9, kind: 'take' },
		]);
		// Copy 9 stays where it is though it now comes first; 4 leaves its slot, and 7 takes a free one.
		expect(pool.assign([9, 7], 1)).toEqual([
			{ slot: 0, copy: 4, kind: 'leave' },
			{ slot: 2, copy: 7, kind: 'take' },
		]);
		expect([...pool.holders]).toEqual([-1, 9, 7]);
	});

	it('frees a slot only once its rows have faded out', () => {
		const pool = new SlotPool(1);
		pool.assign([1], 0);
		expect(pool.assign([2], 10)).toEqual([{ slot: 0, copy: 1, kind: 'leave' }]);
		// While copy 1's rows fade out, copy 2 has no slot.
		expect(pool.refused).toEqual([2]);
		expect(pool.assign([2], 10 + FADE_SECONDS / 2)).toEqual([]);
		// Once they have faded, the slot is freed and taken in the same hand-out.
		expect(pool.assign([2], 10 + FADE_SECONDS)).toEqual([
			{ slot: 0, copy: -1, kind: 'free' },
			{ slot: 0, copy: 2, kind: 'take' },
		]);
	});

	it('gives a copy granted again the slot it is leaving', () => {
		const pool = new SlotPool(2);
		pool.assign([5], 0);
		pool.assign([], 1);
		expect(pool.assign([5], 1.1)).toEqual([{ slot: 0, copy: 5, kind: 'return' }]);
		expect([...pool.holders]).toEqual([5, -1]);
	});

	it('turns the farther copies away when the pool is full', () => {
		const pool = new SlotPool(2);
		pool.assign([5], 0);
		const moves = pool.assign([3, 5, 8, 1], 1);
		expect(moves).toEqual([{ slot: 1, copy: 3, kind: 'take' }]);
		expect(pool.refused).toEqual([8, 1]);
	});

	it('sizes each pool from the budget, the switch pool first, within the slots a species has', () => {
		// Copies of a variant cost 1M to the switch and 3M to the texel range; a 10M budget grants at
		// most ten copies to the switch and three to the texel range.
		expect(poolSizes([{ toSwitch: 1e6, toTexel: 3e6 }], 1e7)).toEqual({ switch: 10, texel: 3 });
		// The cheapest variant sets the count.
		expect(
			poolSizes(
				[
					{ toSwitch: 4e6, toTexel: 9e6 },
					{ toSwitch: 2e6, toTexel: 5e6 },
				],
				1e7,
			),
		).toEqual({ switch: 5, texel: 2 });
		// A small budget holds little; a plant with no further range takes no texel slots.
		expect(poolSizes([{ toSwitch: 3e6, toTexel: 3e6 }], 1e6)).toEqual({ switch: 0, texel: 0 });
		expect(poolSizes([{ toSwitch: 1e5, toTexel: 1e5 }], 1e7)).toEqual({
			switch: POOL_SLOTS,
			texel: 0,
		});
		// The two pools share the species' slots, the switch pool first.
		const both = poolSizes([{ toSwitch: 1e4, toTexel: 2e4 }], 1e7);
		expect(both.switch + both.texel).toBe(POOL_SLOTS);
		expect(both.switch).toBeGreaterThanOrEqual(both.texel);
	});
});
