// The pack's plan: one chosen count for each slot, and no row for a slot that the list does not
// name. A short list leaves the slots past its end at zero, so the pack never repeats the counts
// of the pack before it.
import { describe, expect, it } from 'bun:test';
import { fillPlan } from './chunk-rows';

describe('fillPlan', () => {
	it('fills a short list and leaves the slots past its end at zero', () => {
		const plan = new Float32Array([9, 9, 9, 9]);
		fillPlan(plan, [3, 5]);
		expect([...plan]).toEqual([3, 5, 0, 0]);
	});

	it('keeps every count of a list as long as the plan', () => {
		const plan = new Float32Array(4);
		fillPlan(plan, new Float32Array([1, 2, 3, 4]));
		expect([...plan]).toEqual([1, 2, 3, 4]);
	});

	it('reads a list longer than the plan only as far as the plan goes', () => {
		const plan = new Float32Array(2);
		fillPlan(plan, [7, 8, 9, 10]);
		expect([...plan]).toEqual([7, 8]);
	});

	it('zeroes every slot of an empty list', () => {
		const plan = new Float32Array([4, 4, 4]);
		fillPlan(plan, []);
		expect([...plan]).toEqual([0, 0, 0]);
	});
});
