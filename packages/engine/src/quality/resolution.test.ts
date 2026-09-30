import { describe, expect, it } from 'bun:test';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import {
	BUDGET_MS,
	DROP_AFTER_MS,
	DynamicResolution,
	FAILED_RAISE_MS,
	FRAME_MS,
	FULL_SCALE,
	GPU_DELAY_MS,
	GRACE_MS,
	LONGEST_RAISE_AFTER_MS,
	RAISE_AFTER_MS,
	SCALE_STEP,
	ScaleController,
	SETTLE_MS,
	thousandths,
	WINDOW_END,
	WINDOW_MS,
} from './resolution';

const BUDGET = 1000 / 60;
/** Frames at the target rate whose GPU finished each well within one frame. */
const EASY = { frame: BUDGET, delay: BUDGET / 2 };
/** Frames at half the target rate. */
const SLOW = { frame: 2 * BUDGET, delay: 1.5 * BUDGET };
/** Frames at the target rate that queue on the GPU. */
const QUEUED = { frame: BUDGET, delay: 2.5 * BUDGET };
/** Frames at the target rate whose GPU took more than about one frame for each. */
const BUSY = { frame: BUDGET, delay: 1.5 * BUDGET };

type Frames = { frame: number; delay: number };

/** A controller over synthetic windows of frames, and its clock. */
function controlled(low = 500, high = FULL_SCALE, scale = high) {
	const controller = new ScaleController();
	controller.setRange(low, high);
	controller.scale = scale;
	let now = 0;
	/** Judges one window of `frames`, and returns true when the scale moved. */
	const judge = (frames: Frames): boolean => {
		const before = controller.scale;
		now += WINDOW_MS;
		const { window } = controller;
		window[WINDOW_END] = now;
		window[FRAME_MS] = frames.frame;
		window[GPU_DELAY_MS] = frames.delay;
		window[BUDGET_MS] = BUDGET;
		controller.judge();
		return controller.scale !== before;
	};
	/** Judges windows of `frames` for `ms`, and returns the scale after each. */
	const run = (frames: Frames, ms: number): number[] => {
		const scales: number[] = [];
		for (let k = 0; k < ms / WINDOW_MS; k++) {
			judge(frames);
			scales.push(controller.scale);
		}
		return scales;
	};
	/** Judges windows of `frames` until the scale moves, and returns the time it moved at. */
	const untilStep = (frames: Frames): number => {
		for (let k = 0; k < 10_000; k++) if (judge(frames)) return now;
		throw new Error('the scale never moved');
	};
	return { controller, run, untilStep };
}

/** The times, as window ends from the run's start, at which the scale changed. */
function steps(scales: number[], before: number): number[] {
	const at: number[] = [];
	let last = before;
	scales.forEach((scale, k) => {
		if (scale !== last) at.push((k + 1) * WINDOW_MS);
		last = scale;
	});
	return at;
}

/**
 * The time from a step to the next step up, when the frames have room from the step on: the settle
 * time, less the window that ends as it ends, then the wait before a step up.
 */
const raiseGap = (wait: number) => SETTLE_MS - WINDOW_MS + wait;

describe('the render scale controller', () => {
	it('drops one step after about a second over the budget, then judges the new scale', () => {
		const { run } = controlled();
		const scales = run(SLOW, 6000);
		const first = steps(scales, FULL_SCALE);
		expect(first[0]).toBe(DROP_AFTER_MS);
		// After each step it waits out the settle time, then another second over the budget.
		expect(first[1]).toBe(DROP_AFTER_MS + SETTLE_MS + DROP_AFTER_MS - WINDOW_MS);
		expect(scales.at(-1)).toBe(FULL_SCALE - first.length * SCALE_STEP);
	});

	it('keeps the scale while the frames hold the budget', () => {
		const { run, controller } = controlled(500, FULL_SCALE, 800);
		run(EASY, 4000);
		run(BUSY, 20_000);
		expect(controller.scale).toBe(800);
	});

	it('never leaves its range', () => {
		const { run, controller } = controlled(600, 900, 700);
		run(SLOW, 60_000);
		expect(controller.scale).toBe(600);
		run(EASY, 200_000);
		expect(controller.scale).toBe(900);
	});

	it('counts a GPU delay of two frames or more as over the budget at the full frame rate', () => {
		const { run } = controlled();
		expect(run(QUEUED, DROP_AFTER_MS).at(-1)).toBe(FULL_SCALE - SCALE_STEP);
	});

	it('raises one step only after several seconds with room to spare', () => {
		const { run } = controlled(500, FULL_SCALE, 700);
		const scales = run(EASY, RAISE_AFTER_MS + 2000);
		expect(steps(scales, 700)).toEqual([RAISE_AFTER_MS]);
		expect(scales.at(-1)).toBe(750);
	});

	it('waits twice as long after a step up that took the frames over the budget', () => {
		const { controller, untilStep } = controlled(500, FULL_SCALE, 700);
		const raised = untilStep(EASY);
		// The new scale is too heavy: the frames fall behind, and it drops back.
		const dropped = untilStep(SLOW);
		expect(controller.scale).toBe(700);
		expect(dropped - raised).toBeLessThanOrEqual(FAILED_RAISE_MS);
		expect(untilStep(EASY) - dropped).toBe(raiseGap(2 * RAISE_AFTER_MS));
		expect(controller.scale).toBe(750);
	});

	it('waits no longer than the longest wait before a step up', () => {
		const { controller, untilStep } = controlled(500, FULL_SCALE, 700);
		const gaps: number[] = [];
		let dropped = 0;
		for (let k = 0; k < 8; k++) {
			gaps.push(untilStep(EASY) - dropped);
			expect(controller.scale).toBe(750);
			dropped = untilStep(SLOW);
			expect(controller.scale).toBe(700);
		}
		expect(gaps.slice(1)).toEqual([
			raiseGap(2 * RAISE_AFTER_MS),
			raiseGap(4 * RAISE_AFTER_MS),
			raiseGap(8 * RAISE_AFTER_MS),
			raiseGap(LONGEST_RAISE_AFTER_MS),
			raiseGap(LONGEST_RAISE_AFTER_MS),
			raiseGap(LONGEST_RAISE_AFTER_MS),
			raiseGap(LONGEST_RAISE_AFTER_MS),
		]);
	});

	it('waits the shortest time again after a drop that no step up caused', () => {
		const { run, untilStep } = controlled(500, FULL_SCALE, 700);
		untilStep(EASY);
		untilStep(SLOW);
		// The next step up holds, and some seconds later the scene gets heavier.
		untilStep(EASY);
		run(EASY, 2 * FAILED_RAISE_MS);
		const dropped = untilStep(SLOW);
		expect(untilStep(EASY) - dropped).toBe(raiseGap(RAISE_AFTER_MS));
	});

	it('brings the scale into a new range and holds a range of one scale', () => {
		const controller = new ScaleController();
		expect(controller.scale).toBe(FULL_SCALE);
		controller.setRange(500, 750);
		expect(controller.scale).toBe(750);
		controller.setRange(500, FULL_SCALE);
		expect(controller.scale).toBe(750);
		controller.setRange(800, FULL_SCALE);
		expect(controller.scale).toBe(800);
		controller.setRange(500, 500);
		expect(controller.scale).toBe(500);
	});

	it('turns scales from 0 to 1 into whole thousandths', () => {
		expect(thousandths(0.75)).toBe(750);
		expect(thousandths(0.6)).toBe(600);
		expect(thousandths(1)).toBe(FULL_SCALE);
		expect(thousandths(2)).toBe(FULL_SCALE);
		expect(thousandths(0)).toBe(1);
	});
});

describe('dynamic resolution in the frame loop', () => {
	/** A metrics buffer whose render and completion rings the test writes as frames go. */
	function loop(refreshHz = 60) {
		const metrics = createMetricsBuffer(false, 0);
		const render = new FrameRecorder(metrics, Role.Render);
		const done = new FrameRecorder(metrics, Role.Completion);
		render.setRefreshHz(refreshHz);
		const resolution = new DynamicResolution(metrics);
		resolution.controller.setRange(500, FULL_SCALE);
		let now = 0;
		let frame = 0;
		/** Steps frames `interval` ms apart for `ms`, the GPU taking `delay` for each. */
		const run = (interval: number, delay: number, ms: number): number => {
			for (const end = now + ms; now < end; now += interval) {
				frame++;
				render.begin(frame);
				render.interval(interval);
				render.commit(1);
				done.begin(frame);
				done.interval(interval);
				done.commit(delay);
				resolution.now[0] = now;
				resolution.frame();
			}
			return resolution.controller.scale;
		};
		return { run, resolution };
	}

	it('takes no step in the first seconds of play', () => {
		const { run } = loop();
		expect(run(2 * BUDGET, BUDGET, GRACE_MS)).toBe(FULL_SCALE);
		expect(run(2 * BUDGET, BUDGET, DROP_AFTER_MS + WINDOW_MS)).toBe(FULL_SCALE - SCALE_STEP);
	});

	it('scales the budget from the refresh rate, up to the highest target rate', () => {
		// At 30 hertz, frames 33 ms apart hold the budget.
		const slow = loop(30);
		expect(slow.run(2 * BUDGET, BUDGET, GRACE_MS + 4000)).toBe(FULL_SCALE);
		// At 120 hertz, the target is 60 frames per second, which frames 16 ms apart hold.
		const fast = loop(120);
		expect(fast.run(BUDGET, BUDGET / 2, GRACE_MS + 4000)).toBe(FULL_SCALE);
		expect(fast.run(2 * BUDGET, BUDGET, 3000)).toBeLessThan(FULL_SCALE);
	});

	it('starts its windows again after a pause', () => {
		const { run } = loop();
		run(BUDGET, BUDGET / 2, GRACE_MS + 1000);
		// Slow frames right before a pause and right after it do not add up to a step.
		run(2 * BUDGET, BUDGET, 700);
		run(1000, BUDGET, 1000);
		expect(run(2 * BUDGET, BUDGET, 700)).toBe(FULL_SCALE);
	});
});
