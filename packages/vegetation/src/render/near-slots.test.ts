// The slots of a pool of real pieces: a copy that keeps its grant keeps its slot, a new grant takes a
// free slot nearest copy first, a copy that loses its grant frees its slot, and a full pool turns the
// farther copies away. Each pool is sized from the budget: the most copies it can grant at once.
import { describe, expect, it } from 'bun:test';
import { POOL_SLOTS, poolSizes, SlotPool } from './near-slots';

describe('the slots of a pool of real pieces', () => {
	it('keeps a holder in its slot and gives a newcomer a free one', () => {
		const pool = new SlotPool(3);
		expect(pool.assign([4, 9])).toEqual([
			{ slot: 0, copy: 4 },
			{ slot: 1, copy: 9 },
		]);
		// Copy 9 stays where it is though it now comes first; 4 leaves, 7 takes the freed slot.
		expect(pool.assign([9, 7])).toEqual([{ slot: 0, copy: 7 }]);
		expect([...pool.holders]).toEqual([7, 9, -1]);
	});

	it('frees the slots of copies that lose their grant', () => {
		const pool = new SlotPool(2);
		pool.assign([1, 2]);
		expect(pool.assign([2])).toEqual([{ slot: 0, copy: -1 }]);
		expect([...pool.holders]).toEqual([-1, 2]);
	});

	it('turns the farther copies away when the pool is full', () => {
		const pool = new SlotPool(2);
		pool.assign([5]);
		const moves = pool.assign([3, 5, 8, 1]);
		expect(moves).toEqual([{ slot: 1, copy: 3 }]);
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
