import { describe, expect, test } from 'bun:test';
import { createHeightfield } from './heightfield';
import { defaultSplat } from './splat';

describe('default splat weights', () => {
	test('every layer adds up to one, whatever the ground', () => {
		const field = createHeightfield({
			size: 100,
			resolution: 65,
			height: (x, z) => 10 * Math.sin(x * 0.1) + 6 * Math.cos(z * 0.07),
		});
		const splat = defaultSplat(field);
		const out = [0, 0, 0, 0];
		for (let i = 0; i <= 10; i++)
			for (let j = 0; j <= 10; j++) {
				splat(-45 + i * 9, -45 + j * 9, out);
				const sum =
					(out[0] as number) + (out[1] as number) + (out[2] as number) + (out[3] as number);
				expect(sum).toBeCloseTo(1, 5);
			}
	});

	test('rock takes the steep slopes and snow the high ground', () => {
		// A steep ramp: one side rises fast, the other is flat.
		const steep = createHeightfield({ size: 40, resolution: 41, height: (x) => 3 * x });
		const steepSplat = defaultSplat(steep);
		const out = [0, 0, 0, 0];
		steepSplat(0, 0, out);
		expect(out[2]).toBeGreaterThan(0.5); // rock

		// High ground on the right, low on the left, both gentle.
		const hilly = createHeightfield({
			size: 40,
			resolution: 41,
			height: (x) => (x > 15 ? 20 : 0),
		});
		const hillySplat = defaultSplat(hilly);
		hillySplat(19, 0, out);
		expect(out[3]).toBeGreaterThan(0.5); // snow
		hillySplat(-19, 0, out);
		expect(out[0] as number).toBeGreaterThan(out[3] as number); // grass over snow
	});
});
