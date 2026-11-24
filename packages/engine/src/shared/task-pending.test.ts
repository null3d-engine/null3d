import { afterEach, describe, expect, test } from 'bun:test';
import {
	endPlanHold,
	holdPlans,
	planEnded,
	planStarted,
	planTurn,
	releasePlans,
	tasksPending,
} from './task-pending';

/** Lets every promise reaction that is ready run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('plan turns', () => {
	afterEach(() => endPlanHold());

	test('a live engine lets a plan hand over its levels at once', async () => {
		const plan = planStarted('a mesh');
		let turned = false;
		void planTurn(plan).then(() => {
			turned = true;
		});
		await settle();
		expect(turned).toBe(true);
		planEnded(plan);
	});

	test('hold mode holds the plans back, then lets them go one at a time in the order they started', async () => {
		holdPlans();
		const before = tasksPending();
		const first = planStarted('the first mesh');
		const second = planStarted('the second mesh');
		const order: string[] = [];
		// The second plan answers first, as a job worker may finish it first.
		void planTurn(second).then(() => {
			order.push('second');
			planEnded(second);
		});
		await settle();
		void planTurn(first).then(() => {
			order.push('first');
			planEnded(first);
		});
		await settle();
		expect(order).toEqual([]);
		releasePlans();
		await settle();
		expect(order).toEqual(['first', 'second']);
		expect(tasksPending()).toBe(before);
	});

	test('the end of a hold lets every waiting plan go', async () => {
		holdPlans();
		const plan = planStarted('a mesh');
		let turned = false;
		void planTurn(plan).then(() => {
			turned = true;
		});
		await settle();
		expect(turned).toBe(false);
		endPlanHold();
		await settle();
		expect(turned).toBe(true);
		planEnded(plan);
	});
});
