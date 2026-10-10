import { describe, expect, test } from 'bun:test';
import { type TimeOfDayPreset, timeOfDay } from './time-of-day';

const DEGREE = Math.PI / 180;

const PRESETS: TimeOfDayPreset[] = ['afternoon', 'goldenHour', 'blueHour', 'night'];

/** The sun's height in degrees that a result's sky shows. */
const skyElevation = (hours: number | TimeOfDayPreset) =>
	(Math.asin(timeOfDay(hours).sky.sunPosition[1]) * 180) / Math.PI;

/** The height in degrees of the light's own source: the sun or the moon. */
const lightElevation = (hours: number | TimeOfDayPreset) =>
	(Math.asin(-timeOfDay(hours).light.direction[1]) * 180) / Math.PI;

const luminance = ([r, g, b]: readonly number[]) =>
	0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);

describe('timeOfDay', () => {
	test('puts the sun up by day, highest at noon toward -Z, and the moon up by night', () => {
		expect(skyElevation(12)).toBeCloseTo(60, 5);
		expect(timeOfDay(12).sky.sunPosition[2]).toBeLessThan(0);
		expect(timeOfDay(6).sky.sunPosition[0]).toBeCloseTo(1, 5);
		expect(skyElevation('afternoon')).toBeGreaterThan(30);
		expect(skyElevation('goldenHour')).toBeCloseTo(5.2, 1);
		// After sunset the sky keeps its sun just under the horizon, and the moon lights the scene.
		expect(skyElevation('blueHour')).toBeLessThan(0);
		expect(lightElevation('night')).toBeGreaterThanOrEqual(25);
		expect(timeOfDay('night').light.color[2]).toBe(1);
	});

	test('reads presets as their hours, and wraps hours around the day', () => {
		expect(timeOfDay('afternoon')).toEqual(timeOfDay(15));
		expect(timeOfDay(39)).toEqual(timeOfDay(15));
		expect(timeOfDay(-9)).toEqual(timeOfDay(15));
	});

	test('dims the scene and raises the exposure as the sun sinks', () => {
		const days = PRESETS.map((preset) => timeOfDay(preset));
		const [afternoon, golden, blue, night] = days.map((d) => d.exposure);
		expect(afternoon).toBe(1);
		expect(
			[golden, blue, night].every(
				(e, k) => (e as number) > ([afternoon, golden, blue][k] as number),
			),
		).toBe(true);
		const skies = days.map((d) => luminance(d.ambient.color) * d.ambient.intensity);
		for (let k = 1; k < skies.length; k++)
			expect(skies[k] as number).toBeLessThan(skies[k - 1] as number);
		expect(days[0]?.light.intensity).toBeGreaterThan(days[1]?.light.intensity as number);
	});

	test('gives colors that lights and fog take, warm at golden hour and blue in the afternoon', () => {
		for (const hours of [0, 3, 6, 9, 12, 15, 17.6, 18, 18.4, 19, 21]) {
			const day = timeOfDay(hours);
			for (const color of [day.light.color, day.fog.color, day.ambient.color])
				for (const c of color) {
					expect(c).toBeGreaterThanOrEqual(0);
					expect(c).toBeLessThanOrEqual(1);
				}
			expect(day.skyIntensity).toBeGreaterThan(0);
			expect(day.light.intensity).toBeGreaterThanOrEqual(0);
		}
		const golden = timeOfDay('goldenHour');
		expect(golden.light.color[0]).toBeGreaterThan(golden.light.color[2]);
		const afternoon = timeOfDay('afternoon');
		expect(afternoon.fog.color[2]).toBeGreaterThan(afternoon.fog.color[0]);
	});

	test('lights the night sky from the moon, with blue light', () => {
		for (const hours of ['night', 20, 2, 4.5] as const) {
			const day = timeOfDay(hours, { heading: 2.2 });
			// The sky's sun stands at the moon's place, above the horizon, so the sky has light.
			const moon = day.light.direction.map((c) => -c);
			day.sky.sunPosition.forEach((c, k) => {
				expect(c).toBeCloseTo(moon[k] as number, 9);
			});
			expect(skyElevation(hours)).toBeGreaterThanOrEqual(25);
			for (const color of [day.ambient.color, day.fog.color])
				expect(color[2]).toBeGreaterThan(2 * color[0]);
		}
	});

	test('moves from the dusk sky to the night sky with no jump', () => {
		// The sky's sun moves to the moon's side when the sun is 9 degrees down, at dusk and at
		// dawn. It stands past the model's cutoff there, so the sky shows no change.
		const offset = (12 / Math.PI) * Math.asin(Math.sin(9 * DEGREE) / Math.sin(Math.PI / 3));
		const values = (hours: number) => {
			const day = timeOfDay(hours, { heading: 2.2 });
			return [
				...day.sky.sunPosition,
				Math.log(day.skyIntensity),
				...day.fog.color,
				...day.ambient.color.map((c) => c * day.ambient.intensity),
				day.exposure,
			];
		};
		// Each value changes by a step that shrinks with the step in time. A jump would not shrink.
		const largestStep = (from: number, to: number, dark: number, step: number) => {
			let largest = 0;
			let before = values(from);
			for (let hours = from + step; hours <= to; hours += step) {
				const now = values(hours);
				// The sky's sun is left out of the step across its move.
				const across = (hours - dark) * (hours - step - dark) <= 0;
				for (let k = across ? 3 : 0; k < now.length; k++)
					largest = Math.max(largest, Math.abs((now[k] as number) - (before[k] as number)));
				before = now;
			}
			return largest;
		};
		// From 4 to 13 degrees under the horizon, at dusk and at dawn.
		for (const [from, dark, to] of [
			[18.3, 18 + offset, 19],
			[5, 6 - offset, 5.7],
		] as const) {
			const coarse = largestStep(from, to, dark, 1e-3);
			expect(coarse).toBeLessThan(0.25);
			expect(largestStep(from, to, dark, 1e-4)).toBeLessThan(coarse * 0.2);
			for (const side of [-1e-6, 1e-6])
				expect(timeOfDay(dark + side).sky.sunPosition[1]).toBeLessThan(Math.sin(-2.3 * DEGREE));
		}
	});

	test('turns the sun path with the heading, and sets the noon height', () => {
		const turned = timeOfDay(12, { heading: Math.PI / 2 }).sky.sunPosition;
		expect(turned[0]).toBeCloseTo(-0.5, 5);
		expect(skyElevation(12)).toBeCloseTo(60, 5);
		const low = timeOfDay(12, { noonElevation: Math.PI / 6 }).sky.sunPosition;
		expect((Math.asin(low[1]) * 180) / Math.PI).toBeCloseTo(30, 5);
	});

	test('refuses an hour that is not a finite number, and an unknown preset', () => {
		expect(() => timeOfDay(Number.NaN)).toThrow(RangeError);
		expect(() => timeOfDay('dawn' as TimeOfDayPreset)).toThrow(
			"timeOfDay() got dawn, which takes an hour from 0 to 24 or 'afternoon', 'goldenHour', 'blueHour' or 'night'.",
		);
	});
});
