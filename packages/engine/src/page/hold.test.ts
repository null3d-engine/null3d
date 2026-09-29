import { beforeEach, describe, expect, it } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	HOLD_RESULT_GLOBAL,
	holdFailure,
	holdSeconds,
	MAX_HOLD_SECONDS,
	publishHold,
} from './hold';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

describe('holdSeconds', () => {
	it('runs a live engine without the switch and the option', () => {
		expect(holdSeconds(undefined, undefined)).toBeUndefined();
	});

	it('holds at the time of the switch, over the option', () => {
		expect(holdSeconds(undefined, '1.5')).toBe(1.5);
		expect(holdSeconds(2, '0.25')).toBe(0.25);
		expect(holdSeconds(undefined, '0')).toBe(0);
	});

	it("holds at the option's time for the option or a bare switch, and at 0 for a bare switch alone", () => {
		expect(holdSeconds(2, undefined)).toBe(2);
		expect(holdSeconds(2, '')).toBe(2);
		expect(holdSeconds(undefined, '')).toBe(0);
		expect(holdSeconds(MAX_HOLD_SECONDS, undefined)).toBe(MAX_HOLD_SECONDS);
	});

	it('refuses a time that is not a number of seconds from 0 to the most, with E1407', () => {
		for (const text of ['soon', '-1', '1500ms', 'Infinity', String(MAX_HOLD_SECONDS + 1)]) {
			let error: unknown;
			try {
				holdSeconds(undefined, text);
			} catch (e) {
				error = e;
			}
			expect(error).toBeInstanceOf(EngineError);
			expect((error as EngineError).code).toBe('E1407');
			expect((error as EngineError).message).toStartWith(`E1407: ?hold=${text} is not`);
		}
		expect(() => holdSeconds(Number.NaN, undefined)).toThrow('E1407: the hold option NaN is not');
		expect(() => holdSeconds(-0.5, '')).toThrow('the hold option -0.5');
	});
});

describe('the hold result', () => {
	it('keeps the code of an engine error, and has none for another error', () => {
		const engineError = new EngineError('E1408', 'the sketch failed at 0.5 seconds, in frame 31.');
		expect(holdFailure(engineError)).toEqual({
			ok: false,
			code: 'E1408',
			error: engineError.message,
		});
		expect(holdFailure(new TypeError('x is undefined'))).toEqual({
			ok: false,
			code: null,
			error: 'x is undefined',
		});
	});

	it('is published on the global scope, and cleared when a new hold starts', () => {
		const scope = globalThis as Record<string, unknown>;
		publishHold({ ok: false, code: null, error: 'stopped' });
		expect(scope[HOLD_RESULT_GLOBAL]).toEqual({ ok: false, code: null, error: 'stopped' });
		publishHold(undefined);
		expect(scope[HOLD_RESULT_GLOBAL]).toBeUndefined();
	});
});
