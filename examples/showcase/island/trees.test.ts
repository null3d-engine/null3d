// The island's trees hand over from their near meshes to their cards in groups, so one frame takes
// one group's cards rather than every tree of a species at once. This holds the split that the
// plant's batches take their stands from: each group owns its own stands, every stand stands in
// exactly one group, and the groups' switches are the impostors' own spread distances, in order.
import { describe, expect, it } from 'bun:test';
import { HAND_OVER_GROUPS, handOverSwitches } from '@null3d/impostors';
import { handOverGroups } from './trees';

/** A stand-in for a tree's stand: only its place in the plan matters to the split. */
const stands = (count: number): number[] => Array.from({ length: count }, (_, k) => k);

describe('a plant hands its trees over in groups', () => {
	it('splits the stands by their order, one list per group', () => {
		const groups = handOverGroups(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 200);
		expect(groups.map((group) => group.stands)).toEqual([
			['a', 'e'],
			['b', 'f'],
			['c', 'g'],
			['d'],
		]);
	});

	it('stands every tree exactly once', () => {
		for (const count of [1, 2, 3, 7, 100, 1001]) {
			const split = handOverGroups(stands(count), 200);
			const all = split.flatMap((group) => group.stands);
			expect(all.length).toBe(count);
			expect(new Set(all).size).toBe(count);
			// Every stand keeps the plan's order within its own group.
			for (const group of split)
				for (let k = 1; k < group.stands.length; k++)
					expect(group.stands[k] as number).toBeGreaterThan(group.stands[k - 1] as number);
		}
	});

	it("gives each group its own switch, in the impostors' spread order", () => {
		const switches = handOverSwitches(200);
		expect(switches).toHaveLength(HAND_OVER_GROUPS);
		const groups = handOverGroups(stands(40), 200);
		expect(groups.map((group) => group.switchDistance)).toEqual(switches);
		for (let k = 1; k < groups.length; k++)
			expect((groups[k] as (typeof groups)[number]).switchDistance).toBeGreaterThan(
				(groups[k - 1] as (typeof groups)[number]).switchDistance,
			);
	});

	it('gives the first group the earliest switch and the last the latest', () => {
		const groups = handOverGroups(stands(40), 200);
		expect(groups[0]?.switchDistance).toBeLessThan(200);
		expect(groups.at(-1)?.switchDistance).toBeGreaterThan(200);
		// The cards stand behind every group, from the earliest switch they write.
		expect(groups[0]?.switchDistance).toBeCloseTo(200 * (1 - 0.06), 9);
	});

	it('leaves out the groups that a plant has too few stands to fill', () => {
		const groups = handOverGroups(stands(2), 200);
		expect(groups).toHaveLength(2);
		expect(groups.map((group) => group.stands)).toEqual([[0], [1]]);
	});

	it('leaves a plant with no stands in no group at all', () => {
		expect(handOverGroups([], 200)).toEqual([]);
	});
});
