// The development check that a generated core module belongs with the engine's code.
import { describe, expect, test } from 'bun:test';
import { glueMismatch, type LoadedGlue } from './core';

/** A generated module with every function, and `coreSources` as its build wrote it. */
function glue(coreSources?: string, without?: string): LoadedGlue {
	return new Proxy(
		{},
		{
			get: (_target, name) =>
				name === 'coreSources' ? coreSources : name === without ? undefined : () => 0,
		},
	) as LoadedGlue;
}

describe('the check of a generated core module', () => {
	test('passes a core built from the sources that the dev server gives', () => {
		expect(glueMismatch('threaded', glue('0123456789abcdef'), '0123456789abcdef')).toBeUndefined();
	});

	test('passes any built core when no dev server gives a stamp', () => {
		expect(glueMismatch('single', glue('0123456789abcdef'), undefined)).toBeUndefined();
		expect(glueMismatch('single', glue(), undefined)).toBeUndefined();
	});

	test('fails with E1402 for a core built from other sources, or with no stamp', () => {
		const message = 'the threaded engine core was built from other Rust sources';
		const other = glueMismatch('threaded', glue('fedcba9876543210'), '0123456789abcdef');
		expect(other?.code).toBe('E1402');
		expect(other?.message).toContain(message);
		// A core built before the builds wrote a stamp.
		expect(glueMismatch('threaded', glue(), '0123456789abcdef')?.message).toContain(message);
	});

	test('fails with E1402 for a core that lacks a function', () => {
		const error = glueMismatch('single', glue(undefined, 'batchArrays'), undefined);
		expect(error?.code).toBe('E1402');
		expect(error?.message).toContain('the single engine core lacks batchArrays.');
	});
});
