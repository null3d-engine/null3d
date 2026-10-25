import { describe, expect, it } from 'bun:test';
import {
	budgetNote,
	CHECK_TIMEOUT_MS,
	checkTimeoutMs,
	LOAD_FACTOR_ENV,
	loadFactor,
	MAX_LOAD_FACTOR,
	runLoadFactor,
	scaledBudget,
} from './run-budget.ts';

describe('loadFactor', () => {
	it('is 1 while the load is at most the core count', () => {
		expect(loadFactor(0, 4)).toBe(1);
		expect(loadFactor(3.9, 4)).toBe(1);
		expect(loadFactor(18, 18)).toBe(1);
	});

	it('is the load per core, rounded up', () => {
		expect(loadFactor(19, 18)).toBe(2);
		expect(loadFactor(71, 18)).toBe(4);
	});

	it('stops at the cap', () => {
		expect(loadFactor(500, 18)).toBe(MAX_LOAD_FACTOR);
	});
});

describe('checkTimeoutMs', () => {
	it('multiplies the idle budget by the factor', () => {
		expect(checkTimeoutMs(1)).toBe(CHECK_TIMEOUT_MS);
		expect(checkTimeoutMs(loadFactor(71, 18))).toBe(120_000);
	});
});

describe('scaledBudget', () => {
	it("grows a stated budget by the factor that the run handed on, as the run's own budget grows", () => {
		const env = { [LOAD_FACTOR_ENV]: '4' };
		expect(scaledBudget(60_000, env)).toBe(240_000);
		expect(scaledBudget(60_000, env) / 60_000).toBe(checkTimeoutMs(4) / CHECK_TIMEOUT_MS);
		expect(scaledBudget(60_000, { [LOAD_FACTOR_ENV]: '1' })).toBe(60_000);
	});

	it('reads the machine itself when no run handed a factor, or the handed one is not one', () => {
		for (const handed of [undefined, '', '0', '5', '2.5', 'four'])
			expect(runLoadFactor({ [LOAD_FACTOR_ENV]: handed }, () => 3)).toBe(3);
		expect(runLoadFactor({ [LOAD_FACTOR_ENV]: '2' }, () => 3)).toBe(2);
	});
});

describe('budgetNote', () => {
	it('names a budget that the load raised, and nothing otherwise', () => {
		expect(budgetNote(CHECK_TIMEOUT_MS)).toBe('');
		expect(budgetNote(120_000)).toBe(', 120 s a check at this load');
	});
});
