import { describe, expect, it } from 'bun:test';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import {
	BUDGET_US,
	DROP_AFTER_MS,
	FAILED_RAISE_MS,
	FRAME_US,
	FULL_SCALE,
	farIntervalSteps,
	Governor,
	GovernorLoop,
	type GovernorScene,
	GPU_DELAY_US,
	GRACE_MS,
	LONGEST_RAISE_AFTER_MS,
	RAISE_AFTER_MS,
	SCALE_STEP,
	SETTLE_MS,
	thousandths,
	WINDOW_END,
	WINDOW_MS,
} from './governor';

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

/** A governor over synthetic windows of frames, and its clock. */
function controlled(low = 500, high = FULL_SCALE, scale = high) {
	const controller = new Governor();
	controller.setRange(low, high);
	controller.scale = scale;
	let now = 0;
	/** Judges one window of `frames`, and returns true when the governor took a step. */
	const judge = (frames: Frames): boolean => {
		const before = controller.scale;
		const steps = controller.steps;
		now += WINDOW_MS;
		const { window } = controller;
		window[WINDOW_END] = now;
		window[FRAME_US] = Math.round(frames.frame * 1000);
		window[GPU_DELAY_US] = Math.round(frames.delay * 1000);
		window[BUDGET_US] = Math.round(BUDGET * 1000);
		controller.judge();
		return controller.scale !== before || controller.steps !== steps;
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
		throw new Error('the governor took no step');
	};
	/** The scale, the far cascades' interval and the filter after each step until the steps stop. */
	const ladder = (frames: Frames): string[] => {
		const seen: string[] = [];
		for (let k = 0; k < 400; k++)
			if (judge(frames))
				seen.push(`${controller.scale} ${controller.farInterval} ${controller.filter}`);
		return seen;
	};
	return { controller, run, untilStep, ladder };
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

describe('the render scale steps', () => {
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
		const controller = new Governor();
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

describe('the shadow steps', () => {
	/** A governor whose scene's sun casts shadows in `cascades`, with these shadow settings. */
	function shadowed(cascades: number, filter: number, interval: number, low = 900) {
		const governed = controlled(low);
		governed.controller.setShadows(filter, interval);
		governed.controller.setCascades(cascades);
		return governed;
	}

	it('lowers the render scale first, then the far cascades, then the filter', () => {
		const { ladder } = shadowed(3, 5, 2);
		expect(ladder(SLOW)).toEqual(['950 2 5', '900 2 5', '900 4 5', '900 8 5', '900 8 3']);
	});

	it('raises them again in the reverse order', () => {
		const { ladder, controller } = shadowed(3, 5, 2);
		ladder(SLOW);
		expect(controller.steps).toBe(3);
		expect(ladder(EASY)).toEqual(['900 8 5', '900 4 5', '900 2 5', '950 2 5', '1000 2 5']);
		expect(controller.steps).toBe(0);
	});

	it('takes a shadow step after a second over the budget, and judges it after the settle time', () => {
		const { controller, untilStep } = shadowed(3, 5, 2, FULL_SCALE);
		const first = untilStep(SLOW);
		expect(first).toBe(DROP_AFTER_MS);
		expect(controller.farInterval).toBe(4);
		expect(untilStep(SLOW) - first).toBe(SETTLE_MS + DROP_AFTER_MS - WINDOW_MS);
		expect(controller.farInterval).toBe(8);
	});

	it('takes no shadow step without shadows, nor a far cascade step with one cascade', () => {
		expect(shadowed(0, 5, 2).ladder(SLOW)).toEqual(['950 2 5', '900 2 5']);
		expect(shadowed(1, 5, 2).ladder(SLOW)).toEqual(['950 2 5', '900 2 5', '900 2 3']);
		expect(shadowed(2, 3, 4).ladder(SLOW)).toEqual(['950 4 3', '900 4 3', '900 8 3']);
		expect(shadowed(4, 3, 8).ladder(SLOW)).toEqual(['950 8 3', '900 8 3']);
	});

	it('doubles the far cascade interval up to the longest', () => {
		expect([1, 2, 3, 4, 5, 8].map(farIntervalSteps)).toEqual([3, 2, 2, 1, 1, 0]);
		expect(shadowed(2, 3, 3).ladder(SLOW).slice(2)).toEqual(['900 6 3', '900 8 3']);
	});

	it('keeps its steps within new settings and shadows, and counts each change of what draws', () => {
		const { controller, ladder } = shadowed(3, 5, 2);
		const before = controller.shadowChanges;
		ladder(SLOW);
		expect(controller.shadowChanges - before).toBe(3);
		// A longer interval leaves one far cascade step and the filter's.
		controller.setShadows(5, 4);
		expect([controller.steps, controller.farInterval, controller.filter]).toEqual([2, 8, 3]);
		// The sun stops casting shadows: the steps go.
		controller.setCascades(0);
		expect([controller.steps, controller.farInterval, controller.filter]).toEqual([0, 4, 5]);
		expect(controller.shadowChanges - before).toBe(4);
	});

	it('takes no step while off, and draws the highest scale with the settings as set', () => {
		const { controller, ladder } = shadowed(3, 5, 2);
		ladder(SLOW);
		controller.setOn(false);
		const state = () => [
			controller.scale,
			controller.steps,
			controller.farInterval,
			controller.filter,
		];
		expect(state()).toEqual([FULL_SCALE, 0, 2, 5]);
		expect(ladder(SLOW)).toEqual([]);
		controller.setRange(500, 800);
		expect(controller.scale).toBe(800);
		controller.setOn(true);
		expect(ladder(SLOW)[0]).toBe('750 2 5');
	});
});

describe('the governor in the frame loop', () => {
	/**
	 * A metrics buffer whose render and completion rings the test writes as frames go, and a scene
	 * whose shadows and loading the test sets.
	 */
	function loop(refreshHz = 60, fps?: number) {
		const metrics = createMetricsBuffer(false, 0);
		const render = new FrameRecorder(metrics, Role.Render);
		const done = new FrameRecorder(metrics, Role.Completion);
		render.setRefreshHz(refreshHz);
		const scene = { cascades: 0, loading: false };
		const reads: GovernorScene = {
			shadowCascades: () => scene.cascades,
			loading: () => scene.loading,
		};
		const resolution = new GovernorLoop(new Governor(), metrics, reads, fps);
		resolution.governor.setRange(500, FULL_SCALE);
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
			return resolution.governor.scale;
		};
		return { run, resolution, scene };
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

	it('takes the rate that ?fps= holds as the target', () => {
		// Frames 33 ms apart hold a rate of 30 on a 60 hertz display.
		const held = loop(60, 30);
		expect(held.run(2 * BUDGET, BUDGET, GRACE_MS + 4000)).toBe(FULL_SCALE);
		expect(held.run(3 * BUDGET, BUDGET, 3000)).toBeLessThan(FULL_SCALE);
		// A held rate above the highest target rate keeps that target.
		const fast = loop(120, 90);
		expect(fast.run(2 * BUDGET, BUDGET, GRACE_MS + 3000)).toBeLessThan(FULL_SCALE);
	});

	it('reads the shadows of the scene, and takes no step while the scene loads', () => {
		const { run, resolution, scene } = loop();
		const { governor } = resolution;
		governor.setRange(FULL_SCALE, FULL_SCALE);
		governor.setShadows(5, 2);
		run(BUDGET, BUDGET / 2, GRACE_MS + 1000);
		scene.loading = true;
		run(2 * BUDGET, BUDGET, 3000);
		expect(governor.steps).toBe(0);
		// Loading ends: a second over the budget, and the scene's shadows give the step.
		scene.loading = false;
		scene.cascades = 3;
		run(2 * BUDGET, BUDGET, DROP_AFTER_MS + WINDOW_MS);
		expect([governor.steps, governor.farInterval]).toEqual([1, 4]);
	});

	it('judges nothing while off, and starts with the grace when turned on again', () => {
		const { run, resolution } = loop();
		const { governor } = resolution;
		run(BUDGET, BUDGET / 2, GRACE_MS + 1000);
		governor.setOn(false);
		expect(run(2 * BUDGET, BUDGET, 3000)).toBe(FULL_SCALE);
		governor.setOn(true);
		expect(run(2 * BUDGET, BUDGET, GRACE_MS)).toBe(FULL_SCALE);
		expect(run(2 * BUDGET, BUDGET, DROP_AFTER_MS + WINDOW_MS)).toBe(FULL_SCALE - SCALE_STEP);
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
