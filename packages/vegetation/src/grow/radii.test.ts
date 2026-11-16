// Pipe radii: a node carries the pipes of everything above it, a shed branch's pipes stay, and the
// fit to the stem keeps the twigs' radius.
import { describe, expect, it } from 'bun:test';
import { fitRadii, pipeRadii } from './radii';

describe('pipe radii', () => {
	it('sums the pipes of the tips above each node, by the exponent', () => {
		// A stem node 0, a fork node 1, and two tips 2 and 3.
		const parent = new Int32Array([-1, 0, 1, 1]);
		const live = new Uint8Array([1, 1, 1, 1]);
		const pipes = new Float64Array([0, 0, 1, 1]);
		const out = new Float64Array(4);
		pipeRadii(4, parent, live, pipes, 2, 0.01, out);
		expect(out[2]).toBeCloseTo(0.01, 9);
		expect(out[1]).toBeCloseTo(0.01 * Math.SQRT2, 9);
		expect(out[0]).toBeCloseTo(0.01 * Math.SQRT2, 9);
	});

	it('keeps the pipes of a shed branch in the wood it left', () => {
		const parent = new Int32Array([-1, 0, 1, 1]);
		const live = new Uint8Array([1, 1, 1, 0]);
		const pipes = new Float64Array([0, 1, 1, 1]);
		const out = new Float64Array(4);
		pipeRadii(4, parent, live, pipes, 2, 0.01, out);
		expect(out[3]).toBe(0);
		expect(out[0]).toBeCloseTo(0.01 * Math.SQRT2, 9);
	});

	it('fits the stem and keeps the twigs', () => {
		const radius = new Float64Array([0.1, 0.05, 0.01]);
		fitRadii(radius, 3, 0.01, 0.1, 0.5);
		expect(radius[0]).toBeCloseTo(0.5, 9);
		expect(radius[2]).toBeCloseTo(0.01, 9);
		expect(radius[1]).toBeCloseTo(0.01 + 0.04 * (0.49 / 0.09), 9);
	});
});
