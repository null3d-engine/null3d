import { afterEach, describe, expect, it } from 'bun:test';
import { recordPermutations, stopRecordingPermutations, variantFor } from './variants';

/** A shader's variants: the word without bits, a device-fixed bit, and the vertex color bit. */
const variants = {
	plain: { permutation: 0, wgsl: { source: 'plain' }, glsl: null },
	tone_map: { permutation: 2, wgsl: { source: 'tone map' }, glsl: null },
	vertex_color: { permutation: 4, wgsl: { source: 'vertex color' }, glsl: null },
} as unknown as Parameters<typeof variantFor>[0];

afterEach(() => {
	// A recording that a test leaves running collects the words of later tests' lookups.
	stopRecordingPermutations();
});

describe('variantFor', () => {
	it('records each word that a pipeline asks for, once, in order', () => {
		recordPermutations();
		variantFor(variants, 4, 'wgsl');
		variantFor(variants, 2, 'wgsl');
		variantFor(variants, 4, 'wgsl');
		// The tone mapping bit is fixed by the device, so it leaves the recorded word.
		expect(stopRecordingPermutations()).toEqual([0, 4]);
	});

	it('records nothing when no recording runs', () => {
		variantFor(variants, 0, 'wgsl');
		expect(stopRecordingPermutations()).toEqual([]);
	});
});
