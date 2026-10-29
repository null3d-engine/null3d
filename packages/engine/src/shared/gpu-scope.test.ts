// The names and places of the GPU scopes that the engine writes into its frame records.
import { describe, expect, it } from 'bun:test';
import { SCOPE_BLOOM, SCOPE_NONE, SCOPE_OPAQUE, SCOPE_TRANSPARENT } from '../generated/core';
import { scopeIndex, scopeKind, scopeName, scopePlace } from './gpu-scope';
import { COUNTER_NAMES, COUNTER_SLOTS, GPU_TIMED_PASSES, GpuCounter } from './metrics';

/** A scope of `kind` for the step at `index`. */
const at = (kind: number, index: number) => kind | (index << 16);

describe('the scope of a GPU pass', () => {
	it('splits a code into its kind and its place among steps of that kind', () => {
		expect(scopeKind(at(SCOPE_BLOOM, 2))).toBe(SCOPE_BLOOM);
		expect(scopeIndex(at(SCOPE_BLOOM, 2))).toBe(2);
		expect(scopeKind(SCOPE_NONE)).toBe(SCOPE_NONE);
	});

	it('names an engine step in the overlay’s words', () => {
		expect(scopeName(SCOPE_OPAQUE)).toBe('opaque');
		expect(scopeName(SCOPE_TRANSPARENT)).toBe('transparent');
		expect(scopeName(at(SCOPE_BLOOM, 1))).toBe('bloom 2');
		expect(scopeName(SCOPE_NONE)).toBe('other');
	});

	it('names a sketch pass by its own name where the page knows it', () => {
		const pass = at(SCOPE_OPAQUE, 3);
		expect(scopeName(pass)).toBe('opaque 3');
		expect(scopeName(pass, (place) => (place === 3 ? 'water' : undefined))).toBe('water');
	});

	it('gives a step of a view its pass’s place, and no other step a place', () => {
		expect(scopePlace(at(SCOPE_OPAQUE, 3))).toBe(3);
		expect(scopePlace(SCOPE_OPAQUE)).toBe(0);
		expect(scopePlace(at(SCOPE_BLOOM, 2))).toBe(0);
	});

	it('keeps the scope of each timed pass in a counter slot of the frame record', () => {
		// The GPU's scopes take the counter slots after its own three, whichever the larger of the
		// CPU's counters and the scopes needs.
		expect(COUNTER_SLOTS).toBe(Math.max(COUNTER_NAMES.length, GpuCounter.Scope + GPU_TIMED_PASSES));
	});
});
