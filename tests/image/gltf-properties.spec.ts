// The property tracks of glTF files, which `KHR_animation_pointer` animates: the properties page
// loads the samples of `pages/lib/gltf-properties.ts` with the engine and plays each clip at the
// sampled times, and this test compares each value that its animator wrote with what three.js's
// GLTFLoader, its animation-pointer plugin and its AnimationMixer give for the same time
// (`pages/lib/gltf-properties.json`, from bench/three-fixtures.ts).
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import fixture from '../pages/lib/gltf-properties.json' with { type: 'json' };
import {
	PROPERTY_MODELS,
	type PropertyReading,
	type PropertyReport,
} from '../pages/lib/gltf-properties.ts';

/** How far a value may differ: the engine samples 32-bit numbers, and three.js 64-bit ones. */
const TOLERANCE = 1e-5;

test("KHR_animation_pointer properties match three.js's values at each time", async ({ page }) => {
	await page.goto('gltf-properties.html');
	const result = await pageResult<PropertyReport & { error?: string }>(page, 120_000);
	expect(result.error).toBeUndefined();
	const readings = result.readings;
	const times = PROPERTY_MODELS.reduce((sum, model) => sum + model.times.length, 0);
	expect(readings).toHaveLength(times);
	// A sketch's own animations write through the same setters: a light's color halfway from red
	// to blue, and a camera's field of view halfway from 30 to 60 degrees.
	const [r, g, b] = result.values.color as [number, number, number];
	expect(r).toBeCloseTo(0.5, 5);
	expect(g).toBeCloseTo(0, 5);
	expect(b).toBeCloseTo(0.5, 5);
	expect(result.values.fov).toBeCloseTo(45, 5);
	expect(result.failures).toEqual({
		badPath: 'E1218',
		wrongKeys: 'E1218',
		onAObjectWithoutIt: 'E1218',
	});
	for (const model of fixture.models) {
		const cases = readings.filter((reading) => reading.id === model.id);
		expect(cases, model.id).toHaveLength(model.cases.length);
		for (const [k, want] of model.cases.entries()) {
			const got = cases[k] as PropertyReading;
			expect(got.time, model.id).toBeCloseTo(want.time, 6);
			for (const [key, values] of Object.entries(want.values)) {
				const written = got.values[key];
				expect(written, `${model.id} ${key} at ${want.time}`).toBeDefined();
				const measured = written as number[];
				expect(measured.length, `${model.id} ${key}`).toBe(values.length);
				for (let c = 0; c < values.length; c++) {
					const expected = values[c] as number;
					const difference = Math.abs((measured[c] as number) - expected);
					expect(
						difference,
						`${model.id} ${key}[${c}] at ${want.time}: the engine wrote ${measured[c]}, and three.js ${expected}`,
					).toBeLessThanOrEqual(TOLERANCE * Math.max(1, Math.abs(expected)));
				}
			}
		}
	}
});
