import { describe, expect, test } from 'bun:test';
import {
	countRange,
	countToSlider,
	deviceClass,
	FLOOR_FPS,
	noFrameText,
	RampTracker,
	rampCount,
	rampSteps,
	renderPixelRatio,
	runRamp,
	sliderToCount,
	startCount,
	stopText,
} from './ramp';

const PLAN = { start: 1000, factor: 1.2, max: 20_000 };

describe('the ramp', () => {
	test('raises the count by its factor each step, up to its maximum', () => {
		expect(rampCount(PLAN, 0)).toBe(1000);
		expect(rampCount(PLAN, 1)).toBe(1200);
		expect(rampCount(PLAN, 2)).toBe(1440);
		expect(rampCount(PLAN, 100)).toBe(20_000);
		expect(rampCount(PLAN, rampSteps(PLAN) - 1)).toBe(20_000);
		expect(rampCount(PLAN, rampSteps(PLAN) - 2)).toBeLessThan(20_000);
	});

	test('keeps the largest count at the floor or above, and stops after two steps below it', () => {
		const tracker = new RampTracker(PLAN);
		const step = (step: number, count: number, fps: number) =>
			tracker.add({ step, count, fps, cpuMs: null });
		expect(FLOOR_FPS).toBe(20);
		expect(step(0, 1000, 120)).toBeNull();
		expect(step(1, 1200, 60)).toBeNull();
		// A dip below the floor, then a step that holds again, does not stop the ramp.
		expect(step(2, 1440, 19)).toBeNull();
		expect(step(3, 1728, FLOOR_FPS)).toBeNull();
		expect(step(4, 2074, 15)).toBeNull();
		expect(step(5, 2488, 9)).toBe('below-floor');
		const result = tracker.result();
		expect(result).toMatchObject({ held: 1728, floorFps: 20, stopReason: 'below-floor' });
		expect(result.steps).toHaveLength(6);
		// A step after the stop changes nothing.
		expect(step(6, 3000, 120)).toBe('below-floor');
		expect(tracker.result().held).toBe(1728);
		expect(stopText('three.js', result, 'units')).toBe(
			'three.js fell below 20 fps at 2,488 units (9 fps).',
		);
	});

	test('stops at the maximum when the engine holds every count, and says it is the top of the ramp', () => {
		const tracker = new RampTracker({ start: 100, factor: 2, max: 400 });
		expect(tracker.add({ step: 0, count: 100, fps: 60, cpuMs: 1 })).toBeNull();
		expect(tracker.add({ step: 1, count: 200, fps: 60, cpuMs: 1 })).toBeNull();
		expect(tracker.add({ step: 2, count: 400, fps: 57.4, cpuMs: 1 })).toBe('maximum');
		const result = tracker.result();
		expect(result).toMatchObject({ held: 400, stopReason: 'maximum' });
		expect(stopText('null3D', result, 'units')).toBe(
			'null3D reached the maximum of 400 units at 57.4 fps: the top of this ramp, not a limit of null3D.',
		);
	});

	test("stops at once when the scene's update fails, whatever frame rate the engine shows", () => {
		const tracker = new RampTracker(PLAN);
		expect(tracker.add({ step: 0, count: 1000, fps: 60, cpuMs: 1 })).toBeNull();
		const error = 'E1102: animateObject() failed: the animation table is full';
		expect(tracker.add({ step: 1, count: 1200, fps: 60, cpuMs: 1, error })).toBe('scene-error');
		const result = tracker.result();
		expect(result).toMatchObject({ held: 1000, stopReason: 'scene-error', failure: error });
		expect(stopText('null3D', result, 'units')).toBe(
			`null3D's scene stopped updating at 1,200 units: ${error}.`,
		);
	});

	test('steps past one count that draws no frame, and stops at two in a row', async () => {
		// An engine that holds 60 fps but draws nothing at one count, as Chrome 155 did for three.js's
		// WebGLRenderer at 60 lights, and nothing at all past 1,728.
		let count = 0;
		const result = await runRamp(
			{
				setCount(next) {
					count = next;
				},
				measure: async () =>
					count === 1200 || count > 1728
						? { fps: 0, cpuMs: null, noFrame: true }
						: { fps: 60, cpuMs: 1 },
			},
			PLAN,
			{ wait: async () => {} },
		);
		expect(result).toMatchObject({
			held: 1728,
			drew: 1728,
			skipped: [1200],
			stopReason: 'no-frame',
		});
		expect(result.steps.map((step) => step.count)).toEqual([1000, 1200, 1440, 1728, 2074, 2488]);
		const text = noFrameText('three.js', { ...result, failure: 'a link error' }, 'lights');
		expect(text).toBe(
			'three.js drew no frame at 1,200 lights, but did at the next count, so the ramp stepped past: a fault of this browser (a link error). three.js could not draw 2,488 lights; it drew 1,728 at most (a link error).',
		);
	});

	test('a count that draws no frame at the maximum stops the ramp, and drawing everywhere says nothing', () => {
		const tracker = new RampTracker({ start: 100, factor: 2, max: 400 });
		expect(tracker.add({ step: 0, count: 100, fps: 60, cpuMs: 1 })).toBeNull();
		expect(tracker.add({ step: 1, count: 200, fps: 60, cpuMs: 1 })).toBeNull();
		expect(tracker.add({ step: 2, count: 400, fps: 0, cpuMs: null, noFrame: true })).toBe(
			'no-frame',
		);
		expect(tracker.result()).toMatchObject({ held: 200, drew: 200, skipped: [] });
		const holds = new RampTracker({ start: 100, factor: 2, max: 400 });
		holds.add({ step: 0, count: 100, fps: 60, cpuMs: 1 });
		expect(noFrameText('null3D', holds.result(), 'lights')).toBe('');
	});

	test('runs on an engine: sets each count, settles, measures and reports each step', async () => {
		const asked: string[] = [];
		const steps: number[] = [];
		let count = 0;
		const result = await runRamp(
			{
				setCount(next) {
					count = next;
					asked.push(`count ${next}`);
				},
				// An engine that holds 60 fps up to 1,500 and slows in proportion past it.
				async measure(seconds) {
					asked.push(`measure ${seconds.toFixed(1)}`);
					return { fps: Math.min(60, (60 * 1500) / count), cpuMs: count / 100 };
				},
			},
			PLAN,
			{
				stepSeconds: 1,
				settleSeconds: 0.4,
				onStep: (step) => steps.push(step.count),
				wait: async (seconds) => {
					asked.push(`wait ${seconds}`);
				},
			},
		);
		expect(asked.slice(0, 3)).toEqual(['count 1000', 'wait 0.4', 'measure 0.6']);
		expect(steps).toEqual([1000, 1200, 1440, 1728, 2074, 2488, 2986, 3583, 4300, 5160, 6192]);
		expect(result).toMatchObject({ held: 4300, stopReason: 'below-floor', floorFps: 20 });
	});

	test('stops early when its signal aborts', async () => {
		const controller = new AbortController();
		const result = await runRamp(
			{ setCount() {}, measure: async () => ({ fps: 60, cpuMs: null }) },
			PLAN,
			{
				signal: controller.signal,
				wait: async () => controller.abort(),
				onStep: () => {},
			},
		);
		expect(result.steps).toHaveLength(1);
	});
});

describe('device classes and the count slider', () => {
	test('a fine pointer is a desktop; a coarse one is a tablet or a phone by its short side', () => {
		expect(deviceClass({ shortSideCss: 400, coarsePointer: false })).toBe('desktop');
		expect(deviceClass({ shortSideCss: 820, coarsePointer: true })).toBe('tablet');
		expect(deviceClass({ shortSideCss: 412, coarsePointer: true })).toBe('phone');
	});

	test('caps the pixel ratio by class', () => {
		expect(renderPixelRatio('desktop', 2)).toBe(1);
		expect(renderPixelRatio('phone', 3)).toBe(1.5);
		expect(renderPixelRatio('tablet', 1)).toBe(1);
	});

	test('maps counts to slider positions on a log scale and back', () => {
		expect(countRange(PLAN)).toEqual({ min: 100, max: 20_000 });
		expect(sliderToCount(0, PLAN)).toBe(100);
		expect(sliderToCount(1000, PLAN)).toBe(20_000);
		for (const count of [100, 1000, 5000, 20_000])
			expect(
				Math.abs(sliderToCount(countToSlider(count, PLAN), PLAN) - count) / count,
			).toBeLessThan(0.01);
	});

	test("reads the address's count inside the slider's range", () => {
		expect(startCount(null, PLAN)).toBe(1000);
		expect(startCount('2.5', PLAN)).toBe(1000);
		expect(startCount('50', PLAN)).toBe(100);
		expect(startCount('3000', PLAN)).toBe(3000);
		expect(startCount('99999', PLAN)).toBe(20_000);
	});
});
