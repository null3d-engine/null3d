import { describe, expect, it } from 'bun:test';
import { PROBE_STEP_BYTES, probeSteps } from './probe-steps';

describe('the draws of a probe filter', () => {
	const stride = 256;
	const steps = probeSteps(256, 7, 128, stride);
	const words = new Uint32Array(steps.values);
	const floats = new Float32Array(steps.values);
	const at = (place: number) => (place * stride) / 4;

	it('copies each face, makes six layers of the chain down to one texel, then fills each level', () => {
		// One copy draw that every face shares, 7 smaller levels of 6 layers, and 7 levels.
		expect(steps.count).toBe(1 + 6 * 7 + 7);
		expect(steps.values.byteLength).toBe(steps.count * stride);
		expect(stride).toBeGreaterThanOrEqual(PROBE_STEP_BYTES);
		const places = new Set([steps.gather]);
		for (let layer = 0; layer < 6; layer++)
			for (let level = 1; level < 8; level++) places.add(steps.half(layer, level));
		for (let level = 0; level < 7; level++) places.add(steps.prefilter(level));
		expect(places.size).toBe(steps.count);
	});

	it('gives each half draw its layer and its level size', () => {
		const place = at(steps.half(4, 3));
		expect([...words.slice(place, place + 4)]).toEqual([4, 0, 128, 16]);
	});

	it('gives each level the roughness of its place, as an environment map, and more directions as it blurs more', () => {
		const level0 = at(steps.prefilter(0));
		expect([words[level0 + 1], words[level0 + 3], floats[level0 + 4]]).toEqual([0, 256, 0]);
		const level3 = at(steps.prefilter(3));
		expect(floats[level3 + 4]).toBeCloseTo(1 - Math.sqrt(1 - 3 / 6), 6);
		expect([words[level3 + 1], words[level3 + 2], words[level3 + 3]]).toEqual([512, 128, 32]);
		const last = at(steps.prefilter(6));
		expect(floats[last + 4]).toBe(1);
		expect(words[last + 1]).toBe(1024);
	});
});
