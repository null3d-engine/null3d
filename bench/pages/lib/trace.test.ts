import { describe, expect, test } from 'bun:test';
import { engineTrace, fixedTrace, QualityLog, summarizeTrace, type TraceSecond } from './trace';

describe('QualityLog', () => {
	test('gives the last report before a time, and scale 1 with no steps before any', () => {
		const log = new QualityLog();
		expect(log.before(100)).toEqual([1, 0]);
		log.add([1, 0], 10);
		log.add([0.95, 1], 1500);
		log.add([0.9, 2], 1700);
		expect(log.before(1500)).toEqual([1, 0]);
		expect(log.before(1501)).toEqual([0.95, 1]);
		expect(log.before(5000)).toEqual([0.9, 2]);
	});
});

describe('engineTrace', () => {
	test("joins each second's frame rates with the render scale at its end and its own steps", () => {
		const log = new QualityLog();
		log.add([1, 3], 500);
		log.add([0.95, 4], 2200);
		log.add([0.9, 5], 2600);
		const rates = [
			{ presentedFps: 60, completedFps: 60 },
			{ presentedFps: 58, completedFps: 50 },
			{ presentedFps: 60, completedFps: 57 },
		];
		expect(engineTrace(rates, log, 1000)).toEqual([
			{ presentedFps: 60, completedFps: 60, renderScale: 1, steps: 0 },
			{ presentedFps: 58, completedFps: 50, renderScale: 0.9, steps: 2 },
			{ presentedFps: 60, completedFps: 57, renderScale: 0.9, steps: 0 },
		]);
	});
});

describe('summarizeTrace', () => {
	const second = (completedFps: number | null, renderScale = 1, steps = 0): TraceSecond => ({
		presentedFps: 60,
		completedFps,
		renderScale,
		steps,
	});

	test('counts the seconds whose finished frames held 95% of the rate up to 60 Hz', () => {
		const trace = [second(60), second(57), second(56, 0.9, 1), second(60, 0.85, 2)];
		expect(summarizeTrace(trace, 120)).toEqual({
			seconds: 4,
			targetFps: 60,
			heldSeconds: 3,
			lowestFps: 56,
			lowestRenderScale: 0.85,
			steps: 3,
		});
		expect(summarizeTrace(trace, null).heldSeconds).toBeNull();
	});

	test('judges pages that cannot tell completion by the frames they drew', () => {
		const trace = fixedTrace([30, 29, 28]);
		expect(trace[0]).toEqual({ presentedFps: 30, completedFps: null, renderScale: 1, steps: 0 });
		expect(summarizeTrace(trace, 30)).toMatchObject({
			targetFps: 30,
			heldSeconds: 2,
			lowestFps: 28,
		});
		expect(summarizeTrace([], 60)).toMatchObject({ seconds: 0, heldSeconds: 0, lowestFps: 0 });
	});
});
