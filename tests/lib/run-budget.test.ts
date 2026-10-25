import { describe, expect, it } from 'bun:test';
import { budgetNote, CHECK_TIMEOUT_MS, checkTimeoutMs, MAX_LOAD_FACTOR } from './run-budget.ts';

describe('checkTimeoutMs', () => {
	it('gives the idle budget while the load is at most the core count', () => {
		expect(checkTimeoutMs(0, 4)).toBe(CHECK_TIMEOUT_MS);
		expect(checkTimeoutMs(3.9, 4)).toBe(CHECK_TIMEOUT_MS);
		expect(checkTimeoutMs(18, 18)).toBe(CHECK_TIMEOUT_MS);
	});

	it('multiplies it by the load per core, rounded up', () => {
		expect(checkTimeoutMs(19, 18)).toBe(2 * CHECK_TIMEOUT_MS);
		expect(checkTimeoutMs(71, 18)).toBe(120_000);
	});

	it('stops at the cap, four times the idle budget', () => {
		expect(checkTimeoutMs(500, 18)).toBe(MAX_LOAD_FACTOR * CHECK_TIMEOUT_MS);
	});
});

describe('budgetNote', () => {
	it('names a budget that the load raised, and nothing otherwise', () => {
		expect(budgetNote(CHECK_TIMEOUT_MS)).toBe('');
		expect(budgetNote(120_000)).toBe(', 120 s a check at this load');
	});
});
