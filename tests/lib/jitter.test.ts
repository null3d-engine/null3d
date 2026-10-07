import { describe, expect, it } from 'bun:test';
import {
	BAND_ROWS,
	CONTROL_JITTER_PIXELS,
	FLIGHTS,
	flightFigures,
	JITTER_OBJECTS,
	JITTER_STEPS,
	JITTER_TOLERANCE_PIXELS,
	type JitterResult,
	jitterProblems,
	type Spot,
	spots,
} from '../pages/lib/jitter.ts';
import { jitterPlan, jitterSummary, judge, NONE_MISSING, PLANS } from './plans.ts';
import type { ItemResult } from './runs.ts';

/** A frame whose objects each move `step` pixels along x per frame, plus `extra` in frame `k`. */
function track(step: number, extra: (k: number) => number = () => 0): Spot[][] {
	return Array.from({ length: JITTER_STEPS }, (_, k) =>
		JITTER_OBJECTS.map((_, band) => ({
			x: 100 + band + k * step + extra(k),
			y: (band + 0.5) * BAND_ROWS,
			area: 500,
		})),
	);
}

describe('the jitter figures', () => {
	it('finds the center and the area of an object in its band, edge pixels counted in part', () => {
		const [width, height] = [40, BAND_ROWS * JITTER_OBJECTS.length];
		const rgba = new Uint8Array(width * height * 4);
		const paint = (x: number, y: number, value: number) =>
			rgba.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 3);
		for (let y = 10; y < 20; y++) for (let x = 5; x < 15; x++) paint(x, y, 255);
		// A column of pixels half covered, which sRGB stores as 188 and the figure reads as half.
		for (let y = 10; y < 20; y++) paint(15, y, 188);
		// Dithering of the black background, which counts for nothing.
		paint(30, 30, 1);
		const [first, second] = spots(rgba, width, height);
		expect(first?.area).toBeCloseTo(105, 0);
		expect(first?.x).toBeCloseTo((100 * 10 + 5 * 15.5) / 105, 1);
		expect(first?.y).toBeCloseTo(15, 6);
		expect(second?.area).toBe(0);
		expect(second?.x).toBeNaN();
	});

	it('compares each motion with the same step at the origin, and with its own mean', () => {
		const origin = track(3);
		const [home, far] = FLIGHTS as [(typeof FLIGHTS)[0], (typeof FLIGHTS)[0]];
		expect(flightFigures(home, origin, origin)).toMatchObject({
			jitterPixels: 0,
			ownJitterPixels: 0,
			coverage: 1,
		});
		// A jump of half a pixel in one frame moves two motions by half a pixel.
		const jumped = flightFigures(
			far,
			track(3, (k) => (k === 5 ? 0.5 : 0)),
			origin,
		);
		expect(jumped.jitterPixels).toBeCloseTo(0.5, 9);
		expect(jumped.ownJitterPixels).toBeCloseTo(0.5, 9);
		expect(jumped.motionPixels[0]).toBeCloseTo(3, 9);
		// An object that left the frame in one frame fails the flight.
		const lost = track(3);
		lost[4]![2] = { x: Number.NaN, y: Number.NaN, area: 0 };
		expect(flightFigures(far, lost, origin)).toMatchObject({
			jitterPixels: Number.POSITIVE_INFINITY,
			coverage: 0,
		});
	});

	it('passes far flights within the tolerance and controls that jitter, and fails the others', () => {
		const origin = track(3);
		const result = (farJump: number, controlJump: number): JitterResult => ({
			tier: 'webgpu',
			width: 480,
			height: 270,
			flights: FLIGHTS.map((flight) =>
				flightFigures(
					flight,
					track(3, (k) =>
						k !== 7 || flight.distance === 0 ? 0 : flight.cellsFull ? controlJump : farJump,
					),
					origin,
				),
			),
		});
		expect(jitterProblems(result(0.01, 2))).toEqual([]);
		const problems = jitterProblems(result(2 * JITTER_TOLERANCE_PIXELS, CONTROL_JITTER_PIXELS / 2));
		expect(problems).toHaveLength(4);
		expect(problems[0]).toContain(`over the limit of ${JITTER_TOLERANCE_PIXELS} px`);
		expect(problems[3]).toContain('with every cell taken');
	});
});

describe('the jitter plan', () => {
	const items = jitterPlan();

	it('runs the jitter page on each GPU path, with its frames', () => {
		expect(PLANS.jitter).toBe(jitterPlan);
		expect(items.map((item) => item.path)).toEqual([
			'/tests/pages/jitter.html?gpu=webgpu&images',
			'/tests/pages/jitter.html?gpu=webgl2&images',
		]);
	});

	it('judges the figures and tables each flight', () => {
		const origin = track(3);
		const result = {
			ok: true,
			tier: 'webgl2',
			width: 480,
			height: 270,
			flights: FLIGHTS.map((flight) =>
				flightFigures(
					flight,
					track(3, (k) => (flight.cellsFull && k === 3 ? 1 : 0)),
					origin,
				),
			),
		} as unknown as ItemResult;
		expect(judge(items[1]!.check, result, NONE_MISSING)).toEqual([]);
		const table = jitterSummary(items, (id) => (id === 'jitter-webgl2' ? result : undefined));
		const rows = table?.split('\n').slice(4);
		expect(rows?.[0]).toBe('| webgpu | no result; the runner stopped before this page | | | |');
		expect(rows?.[2]).toBe('| webgl2 | 1000km | 0.0000 | 0.0000 | 100.0% |');
		expect(rows?.[4]).toBe('| webgl2 | 1000km-cells-off | 1.0000 | 1.0000 | 100.0% |');
		expect(jitterSummary(PLANS.checks!(), () => undefined)).toBeUndefined();
	});
});
