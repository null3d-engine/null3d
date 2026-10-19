import { describe, expect, test } from 'bun:test';
import { type TimeOfDayPreset, timeOfDay } from './time-of-day';

const DEGREE = Math.PI / 180;

const PRESETS: TimeOfDayPreset[] = ['afternoon', 'goldenHour', 'blueHour', 'night'];

/** The band the physical exposure stays in, and the largest step it may take between adjacent hours. */
const PHYSICAL_EXPOSURE_BAND = [0.5, 4] as const;
const PHYSICAL_EXPOSURE_STEP = 1.5;

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

	test('fades the sunset sky straight into the moon sky as night falls', () => {
		// The sun 9 degrees down, halfway through nightfall, at dusk and at dawn.
		const offset = (12 / Math.PI) * Math.asin(Math.sin(9 * DEGREE) / Math.sin(Math.PI / 3));
		for (const hours of [18 + offset, 6 - offset]) {
			const day = timeOfDay(hours, { heading: 2.2 });
			// The first sky keeps the sunset's sun under the horizon, and the moon's sky adds to it.
			expect(skyElevation(hours)).toBeCloseTo(-1.2, 5);
			expect(day.sky.secondSkyWeight).toBeGreaterThan(0);
			const moon = day.light.direction.map((c) => -c);
			day.sky.secondSunPosition.forEach((c, k) => {
				expect(c).toBeCloseTo(moon[k] as number, 9);
			});
		}
		for (const hours of ['afternoon', 'blueHour', 'night', 18.3, 19.2] as const)
			expect(timeOfDay(hours).sky.secondSkyWeight).toBe(0);
	});

	test('keeps the sky at the dusk table, whose night value is 0.003', () => {
		// The ambient light is the sky's average light times π, and the table sets its luminance.
		const sky = (hours: number | TimeOfDayPreset) => {
			const { ambient } = timeOfDay(hours, { heading: 2.2 });
			return luminance(ambient.color.map((c) => c * ambient.intensity)) / Math.PI;
		};
		expect(sky('night')).toBeCloseTo(0.003, 6);
		expect(sky(21)).toBeCloseTo(0.003, 6);
		// Halfway through nightfall, between 0.008 and 0.003 in log space.
		const offset = (12 / Math.PI) * Math.asin(Math.sin(9 * DEGREE) / Math.sin(Math.PI / 3));
		expect(sky(18 + offset)).toBeCloseTo(Math.sqrt(0.008 * 0.003), 6);
	});

	test('moves from the dusk sky to the night sky with no jump', () => {
		// The light of each sky, the air, the fog, the ambient light and the exposure.
		const values = (hours: number) => {
			const day = timeOfDay(hours, { heading: 2.2 });
			const moon = day.light.direction.map((c) => -c);
			const atMoon = day.sky.sunPosition.every((c, k) => Math.abs(c - (moon[k] as number)) < 1e-9);
			const moonSky = atMoon ? day.skyIntensity : day.skyIntensity * day.sky.secondSkyWeight;
			return [
				atMoon ? 0 : day.skyIntensity,
				moonSky,
				day.sky.turbidity,
				day.sky.rayleigh,
				...day.fog.color,
				...day.ambient.color.map((c) => c * day.ambient.intensity),
				day.exposure,
			];
		};
		// Each value's largest step, which shrinks with the step in time. A jump would not shrink.
		const largestSteps = (from: number, to: number, step: number) => {
			let before = values(from);
			const largest = before.map(() => 0);
			for (let hours = from + step; hours <= to; hours += step) {
				const now = values(hours);
				now.forEach((v, k) => {
					largest[k] = Math.max(largest[k] as number, Math.abs(v - (before[k] as number)));
				});
				before = now;
			}
			return largest;
		};
		// From 4 to 13 degrees under the horizon, at dusk and at dawn.
		for (const [from, to] of [
			[18.3, 19],
			[5, 5.7],
		] as const) {
			const coarse = largestSteps(from, to, 1e-3);
			const fine = largestSteps(from, to, 1e-4);
			coarse.forEach((c, k) => {
				expect(fine[k] as number).toBeLessThanOrEqual(c * 0.2 + 1e-12);
			});
		}
	});

	test('turns the sun path with the heading, and sets the noon height', () => {
		const turned = timeOfDay(12, { heading: Math.PI / 2 }).sky.sunPosition;
		expect(turned[0]).toBeCloseTo(-0.5, 5);
		expect(skyElevation(12)).toBeCloseTo(60, 5);
		const low = timeOfDay(12, { noonElevation: Math.PI / 6 }).sky.sunPosition;
		expect((Math.asin(low[1]) * 180) / Math.PI).toBeCloseTo(30, 5);
	});

	test('matches the physical sky with the physical model', () => {
		const physical = (hours: number | TimeOfDayPreset) => timeOfDay(hours, { model: 'physical' });
		const noon = physical(12);
		expect(noon.skyIntensity).toBe(1);
		// The day's brighter physical sky needs less exposure than the analytic model's, so the
		// scene keeps contrast.
		expect(noon.exposure).toBeGreaterThan(0.4);
		expect(noon.exposure).toBeLessThan(1);
		// A high sun's light through the air: about 3.2, a little warm.
		expect(noon.light.intensity).toBeGreaterThan(3);
		expect(noon.light.intensity).toBeLessThan(3.6);
		expect(noon.light.color[2]).toBeLessThan(noon.light.color[0]);
		expect(noon.atmosphere.sunPosition).toEqual(timeOfDay(12).atmosphere.sunPosition);
		expect(noon.atmosphere.moonIntensity).toBe(0);
		expect(noon.atmosphere.stars).toBe(0);
		// A setting sun reddens, and the night has the moon and the stars.
		const golden = physical('goldenHour');
		expect(golden.light.color[2]).toBeLessThan(0.5 * golden.light.color[0]);
		const night = physical('night');
		expect(night.atmosphere.moonIntensity).toBeGreaterThan(0);
		expect(night.atmosphere.stars).toBe(1);
		expect(night.light.color).toEqual(timeOfDay('night').light.color);
		// The exposure rises through dusk, within its band, and settles under the moon.
		const blue = physical('blueHour');
		expect(blue.exposure).toBeGreaterThan(golden.exposure);
		expect(blue.exposure).toBeLessThanOrEqual(PHYSICAL_EXPOSURE_BAND[1]);
		expect(night.exposure).toBeLessThan(blue.exposure);
		expect(night.exposure).toBeGreaterThan(1);
	});

	test('keeps the physical fog at the sky’s mean light at every hour, so no hour tints the scene', () => {
		// The fog takes the sky's mean light at every hour, and the exposure follows that mean, so
		// the fog is as bright as the sky around it rather than as bright as its brightest band. The
		// mean of a clear sky carries its blue, so a fog of it never takes a low sun's warm glow and
		// never tints the shaded surfaces brown, at any hour.
		const fog = (hours: number | TimeOfDayPreset) =>
			timeOfDay(hours, { model: 'physical' }).fog.color;
		for (const hours of [6.2, 9, 12, 15, 'goldenHour', 18, 'blueHour', 20, 23] as const) {
			const color = fog(hours);
			expect(color[0] as number).toBeLessThanOrEqual(1.1 * (color[2] as number));
		}
	});

	test('changes the physical values with no jump as the day passes', () => {
		// Steps of 2 minutes through dusk and dawn: each value changes by a small share.
		for (const [start, end] of [
			[17, 19.5],
			[4.5, 7],
		]) {
			let before = timeOfDay(start as number, { model: 'physical' });
			for (let h = (start as number) + 1 / 30; h <= (end as number); h += 1 / 30) {
				const day = timeOfDay(h, { model: 'physical' });
				const change = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b, 1e-6);
				expect(change(day.exposure, before.exposure)).toBeLessThan(0.4);
				expect(
					change(
						luminance(day.ambient.color) * day.ambient.intensity,
						luminance(before.ambient.color) * before.ambient.intensity,
					),
				).toBeLessThan(0.5);
				before = day;
			}
		}
	});

	test('keeps the physical exposure in its band with a step of under 1.5x', () => {
		const [low, high] = PHYSICAL_EXPOSURE_BAND;
		let before = timeOfDay(0, { model: 'physical' }).exposure;
		expect(before).toBeGreaterThanOrEqual(low);
		expect(before).toBeLessThanOrEqual(high);
		// The exposure makes up for the physical sky as it dims, so it never spikes at the horizon.
		for (let hours = 0.1; hours <= 24.0001; hours += 0.1) {
			const now = timeOfDay(hours, { model: 'physical' }).exposure;
			expect(now).toBeGreaterThanOrEqual(low);
			expect(now).toBeLessThanOrEqual(high);
			expect(Math.max(now / before, before / now)).toBeLessThan(PHYSICAL_EXPOSURE_STEP);
			before = now;
		}
	});

	test('hands the physical main light from the sun to the moon with no zero dip', () => {
		// The sun's direct light is extinguished at the horizon and the moon's rises, but the two
		// overlap, so the main light never falls to zero and the scene never goes unlit.
		let least = Number.POSITIVE_INFINITY;
		for (let hours = 0; hours <= 24.0001; hours += 0.1)
			least = Math.min(least, timeOfDay(hours, { model: 'physical' }).light.intensity);
		expect(least).toBeGreaterThan(0.05);
	});

	test('moves the physical main light with no jump through the day', () => {
		// The direction sweeps from the sun to the moon and its intensity cross-fades, with no step
		// like the old jump to a moon 25 degrees up at the horizon.
		let before = timeOfDay(0, { model: 'physical' }).light;
		for (let hours = 0.05; hours <= 24.0001; hours += 0.05) {
			const light = timeOfDay(hours, { model: 'physical' }).light;
			const step = Math.hypot(
				light.direction[0] - before.direction[0],
				light.direction[1] - before.direction[1],
				light.direction[2] - before.direction[2],
			);
			expect(step).toBeLessThan(0.3);
			expect(Math.abs(light.intensity - before.intensity)).toBeLessThan(0.5);
			before = light;
		}
	});

	test('keeps the moon out of the physical main light until the sun is down', () => {
		for (let hours = 6; hours <= 18.0001; hours += 0.05) {
			const day = timeOfDay(hours, { model: 'physical' });
			const sun = (Math.asin(day.atmosphere.sunPosition[1]) * 180) / Math.PI;
			// The light's height is held at the horizon as the sun sinks to it (see the horizon
			// test), so the two heights meet only while the sun stands above that hold.
			if (sun <= 1) continue;
			// While the sun stands up, the main light is the sun, not the moon.
			const light = (Math.asin(-day.light.direction[1]) * 180) / Math.PI;
			expect(light).toBeCloseTo(sun, 5);
		}
	});

	test('puts the physical presets at the sun heights their names give', () => {
		const sunHeight = (hours: number | TimeOfDayPreset) =>
			(Math.asin(timeOfDay(hours, { model: 'physical' }).atmosphere.sunPosition[1]) * 180) /
			Math.PI;
		expect(sunHeight('goldenHour')).toBeCloseTo(5, 0);
		expect(sunHeight('blueHour')).toBeCloseTo(-5, 0);
		expect(sunHeight('night')).toBeLessThan(-12);
		// Blue hour is still the setting sun, so the moon has not taken the main light yet, and the
		// light grazes the horizon from just above it rather than shining up from below.
		const blue = timeOfDay('blueHour', { model: 'physical' });
		const blueLight = (Math.asin(-blue.light.direction[1]) * 180) / Math.PI;
		expect(blueLight).toBeGreaterThan(0);
		expect(blueLight).toBeLessThan(2);
		// Once night has fallen, the main light is the moon, from the moon's place.
		const night = timeOfDay('night', { model: 'physical' });
		expect((Math.asin(-night.light.direction[1]) * 180) / Math.PI).toBeGreaterThan(25);
	});

	test('keeps the physical main light above the horizon through the handover', () => {
		// The main light's height passes from the sun's own place to the moon's as the sun sets, and
		// its intensity is still on through that stretch, so the light must not shine up from under
		// the ground at any hour of it.
		for (const model of ['analytic', 'physical'] as const)
			for (let hours = 17; hours <= 21.0001; hours += 0.1) {
				const day = timeOfDay(hours, { model });
				expect(day.light.intensity).toBeGreaterThan(0);
				expect(day.light.direction[1]).toBeLessThanOrEqual(0);
			}
	});

	test('keeps the physical light continuous, with the crossing no darker than night', () => {
		// The total light that a flat surface would take: the key's share and the ambient's, each
		// times the exposure.
		const total = (hours: number) => {
			const day = timeOfDay(hours, { model: 'physical' });
			const key = Math.max(0, -day.light.direction[1]) * day.light.intensity;
			const ambient = luminance(day.ambient.color) * day.ambient.intensity;
			return (key + ambient) * day.exposure;
		};
		// The sun on the horizon, at dawn and at dusk, is not darker than the deep night.
		const night = total(23);
		for (const hours of [5.5, 6, 6.5, 17.5, 18, 18.5]) expect(total(hours)).toBeGreaterThan(night);
		// From sunset to midnight, no hour falls more than a tenth below the night's value, so the
		// route through dusk never goes darker than midnight.
		for (let hours = 18; hours <= 24.0001; hours += 0.25)
			expect(total(hours)).toBeGreaterThan(night * 0.9);
		// The day outshines the crossing.
		expect(total(12)).toBeGreaterThan(total(18));
		// The total light is continuous: no step of 0.05 hours changes it by more than 1.25 times.
		let before = total(0);
		for (let hours = 0.05; hours <= 24.0001; hours += 0.05) {
			const now = total(hours);
			expect(Math.max(now / before, before / now)).toBeLessThan(1.25);
			before = now;
		}
	});

	test("keeps the physical sky's mean light continuous across the horizon", () => {
		// The ambient light carries the sky's mean light, and across the horizon the moon adds none,
		// so its luminance follows the sun's sky mean there. A jump would not shrink with the step.
		const meanLight = (hours: number) => {
			const day = timeOfDay(hours, { model: 'physical' });
			return luminance(day.ambient.color) * day.ambient.intensity;
		};
		const elevation = (hours: number) =>
			(Math.asin(timeOfDay(hours, { model: 'physical' }).atmosphere.sunPosition[1]) * 180) /
			Math.PI;
		const largestStep = (from: number, to: number, step: number) => {
			let before = -1;
			let largest = 0;
			for (let hours = from; hours <= to; hours += step) {
				const degrees = elevation(hours);
				if (degrees > 3 || degrees < -6) continue;
				const now = meanLight(hours);
				if (before >= 0)
					largest = Math.max(largest, Math.abs(now - before) / Math.max(now, before, 1e-12));
				before = now;
			}
			return largest;
		};
		for (const [from, to] of [
			[5.5, 6.3],
			[17.7, 18.5],
		] as const) {
			const coarse = largestStep(from, to, 1e-3);
			const fine = largestStep(from, to, 1e-4);
			expect(fine).toBeLessThanOrEqual(coarse * 0.2 + 1e-12);
		}
	});

	test('refuses an hour that is not a finite number, and an unknown preset', () => {
		expect(() => timeOfDay(Number.NaN)).toThrow(RangeError);
		expect(() => timeOfDay('dawn' as TimeOfDayPreset)).toThrow(
			"timeOfDay() got dawn, which takes an hour from 0 to 24 or 'afternoon', 'goldenHour', 'blueHour' or 'night'.",
		);
	});
});
