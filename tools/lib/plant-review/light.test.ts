import { describe, expect, test } from 'bun:test';
import {
	blueGained,
	LIGHT_CALIBRATION,
	LIGHT_PROBE,
} from '../../../tests/pages/lib/plant-review/light.ts';

describe('the review light calibration', () => {
	test('refuses a single neutral constant', () => {
		const { flat, daylight, blue } = LIGHT_CALIBRATION;
		// The flat fallback has no sun, so its light needs less than the daylight rig's; and the
		// studio light's warm tint leaves blue a tenth short. One constant fails both measured facts.
		expect(daylight - flat).toBeGreaterThan(0.5);
		expect(blue - 1).toBeGreaterThan(0.05);
	});

	test("holds each rig factor inside the known surface's measured red and green scales", () => {
		for (const rig of ['flat', 'daylight'] as const) {
			const scales = [LIGHT_PROBE[rig].foot, LIGHT_PROBE[rig].collar].flatMap(([red, green]) => [
				red,
				green,
			]);
			expect(LIGHT_CALIBRATION[rig]).toBeGreaterThanOrEqual(Math.min(...scales) - 0.05);
			expect(LIGHT_CALIBRATION[rig]).toBeLessThanOrEqual(Math.max(...scales) + 0.05);
		}
	});

	test("puts the blue channel on the least-shaded end's measured scale", () => {
		for (const rig of ['flat', 'daylight'] as const) {
			const factor = LIGHT_CALIBRATION[rig] * LIGHT_CALIBRATION.blue;
			expect(Math.abs(factor - LIGHT_PROBE[rig].collar[2])).toBeLessThan(0.35);
		}
	});

	test('dims red and green on a light colour so its blue gains', () => {
		const white = blueGained('#ffffff');
		expect(white).toBe('#e8e8ff');
		const grey = blueGained('#808080');
		expect(grey).toBe('#747480');
	});
});
