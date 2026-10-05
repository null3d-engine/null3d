import { describe, expect, it } from 'bun:test';
import { SHADOW_CASTERS_TILES } from '../generated/core';
import { FramePacer } from '../render/pacer';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import { HELD_PERCENT, TARGET_CAP_HZ } from '../shared/stats';
import {
	BUDGET_US,
	DROP_AFTER_MS,
	FAILED_RAISE_MS,
	FRAME_US,
	FULL_SCALE,
	farIntervalSteps,
	GAP_MS,
	Governor,
	GovernorLoop,
	type GovernorScene,
	GPU_DELAY_US,
	GRACE_MS,
	LONGEST_RAISE_AFTER_MS,
	LOWEST_AO_SCALE,
	RAISE_AFTER_MS,
	SCALE_STEP,
	SETTLE_MS,
	SMALLEST_BLOOM_SIZE,
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
/** Frames at `fps` frames per second whose GPU finished each within one frame. */
const atRate = (fps: number) => ({ frame: 1000 / fps, delay: BUDGET });
/** True when a second at `fps` holds the target, as the benchmark reports count it. */
const holds = (fps: number) => fps * 100 >= HELD_PERCENT * TARGET_CAP_HZ;

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

	it('drops a step when the frames run under the rate at which a second holds the target', () => {
		// On the warm iPad, S4 ran at 54 to 57 frames per second for minutes at one render scale.
		// The frames came 8% slower than the target: a missed second for the benchmark report.
		expect(holds(55)).toBe(false);
		const { run, controller } = controlled(500, FULL_SCALE, 850);
		run(atRate(55), DROP_AFTER_MS);
		expect(controller.scale).toBe(800);
	});

	it('rests where the frames hold the target without room to spare', () => {
		// Between the line at which a second holds the target and the line of room, the governor
		// takes no step either way.
		expect(holds(57)).toBe(true);
		const { run, controller } = controlled(500, FULL_SCALE, 800);
		run(atRate(57), 60_000);
		run(atRate(58), 60_000);
		expect(controller.scale).toBe(800);
	});

	it('takes no step for a short stall amid frames at the target rate', () => {
		// A quarter second of frames at a third of the rate takes the second's mean past the line,
		// but a lower setting would not help a stall.
		const { run, controller } = controlled();
		run(EASY, 2000);
		run({ frame: 3 * BUDGET, delay: BUDGET }, WINDOW_MS);
		run(EASY, 2000);
		expect(controller.scale).toBe(FULL_SCALE);
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

	it('counts a step down late in the trial of a step up as its failure', () => {
		// On the warm iPad, a step up held the target at first and fell behind 9 to 15 s later.
		const { run, controller, untilStep } = controlled(500, 650, 600);
		const raised = untilStep(EASY);
		expect(controller.scale).toBe(650);
		run(EASY, 12_000);
		const dropped = untilStep(atRate(55));
		expect(controller.scale).toBe(600);
		expect(dropped - raised).toBeLessThanOrEqual(FAILED_RAISE_MS);
		expect(untilStep(EASY) - dropped).toBe(raiseGap(2 * RAISE_AFTER_MS));
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
		const { run, untilStep } = controlled(500, 750, 700);
		untilStep(EASY);
		untilStep(SLOW);
		// The next step up reaches the highest scale and holds through its trial, and some seconds
		// later the scene gets heavier.
		untilStep(EASY);
		run(EASY, FAILED_RAISE_MS);
		const dropped = untilStep(SLOW);
		expect(untilStep(EASY) - dropped).toBe(raiseGap(RAISE_AFTER_MS));
	});

	it('judges room on the mean frame time since the room started', () => {
		// Windows a little over and under the budget, which average within it, have room.
		const uneven = controlled(500, FULL_SCALE, 700);
		const scales: number[] = [];
		for (let k = 0; k < (RAISE_AFTER_MS + 2000) / WINDOW_MS; k++)
			scales.push(
				...uneven.run({ frame: (k % 2 ? 1.05 : 0.97) * BUDGET, delay: BUDGET / 2 }, WINDOW_MS),
			);
		expect(steps(scales, 700)).toEqual([RAISE_AFTER_MS]);
		// Frames that run a little long all the time have none.
		const long = controlled(500, FULL_SCALE, 700);
		long.run({ frame: 1.04 * BUDGET, delay: BUDGET / 2 }, 4 * RAISE_AFTER_MS);
		expect(long.controller.scale).toBe(700);
		// Once the frames speed up, the long frames of at most one wait before count against them.
		expect(long.untilStep(EASY) - 4 * RAISE_AFTER_MS).toBeLessThanOrEqual(2 * RAISE_AFTER_MS);
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
	function shadowed(cascades: number, filter: number, interval: number, low = 900, tiles = false) {
		const governed = controlled(low);
		governed.controller.setShadows(filter, interval);
		governed.controller.setCasters(cascades, tiles);
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

	it("lightens the filter of point and spot lights' shadows without a shadowed sun", () => {
		expect(shadowed(0, 5, 2, 900, true).ladder(SLOW)).toEqual(['950 2 5', '900 2 5', '900 2 3']);
	});

	it('doubles the far cascade interval up to the longest', () => {
		expect([1, 2, 3, 4, 5, 8].map(farIntervalSteps)).toEqual([3, 2, 2, 1, 1, 0]);
		expect(shadowed(2, 3, 3).ladder(SLOW).slice(2)).toEqual(['900 6 3', '900 8 3']);
	});

	it('keeps its steps within new settings and shadows, and counts each change of what draws', () => {
		const { controller, ladder } = shadowed(3, 5, 2);
		const before = controller.stepChanges;
		ladder(SLOW);
		expect(controller.stepChanges - before).toBe(3);
		// A longer interval leaves one far cascade step and the filter's.
		controller.setShadows(5, 4);
		expect([controller.steps, controller.farInterval, controller.filter]).toEqual([2, 8, 3]);
		// The sun stops casting shadows: the steps go.
		controller.setCasters(0, false);
		expect([controller.steps, controller.farInterval, controller.filter]).toEqual([0, 4, 5]);
		expect(controller.stepChanges - before).toBe(4);
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

describe('the bloom steps', () => {
	it("halves bloom's base after the shadow steps, only while bloom is on", () => {
		const { controller, untilStep } = controlled(900);
		controller.setShadows(5, 2);
		controller.setCasters(1, false);
		controller.setBloom(true, 512);
		const seen: string[] = [];
		for (let k = 0; k < 4; k++) {
			untilStep(SLOW);
			seen.push(`${controller.scale} ${controller.filter} ${controller.bloomHalvings}`);
		}
		// The scale drops twice, then the filter lightens, then bloom's base halves once.
		expect(seen).toEqual(['950 5 0', '900 5 0', '900 3 0', '900 3 1']);
		expect(controller.steps).toBe(2);
		expect(controller.maxSteps).toBe(2);
		// Bloom turned off takes its step back at once, and changes what draws.
		const before = controller.stepChanges;
		controller.setBloom(false, 512);
		expect([controller.steps, controller.bloomHalvings]).toEqual([1, 0]);
		expect(controller.stepChanges).toBe(before + 1);
	});

	it("halve ambient occlusion's scale last, while it draws at half the render size", () => {
		const { controller, untilStep } = controlled(950);
		controller.setBloom(true, 128);
		controller.setAo(true, 500);
		expect(controller.aoScale).toBe(500);
		const seen: string[] = [];
		for (let k = 0; k < 3; k++) {
			untilStep(SLOW);
			seen.push(`${controller.scale} ${controller.bloomHalvings} ${controller.aoScale}`);
		}
		// The scale drops to its lowest, then bloom's base halves, then ambient occlusion draws at
		// a quarter.
		expect(seen).toEqual(['950 0 500', '950 1 500', '950 1 250']);
		expect(controller.maxSteps).toBe(2);
		// Turned off, it takes its step back at once.
		controller.setAo(false, 500);
		expect([controller.steps, controller.aoScale]).toEqual([1, 500]);
		// A quarter has no step, and a scale of 0 draws nothing to step.
		controller.setAo(true, 250);
		controller.setAo(true, 0);
		expect(controller.maxSteps).toBe(1);
		expect(LOWEST_AO_SCALE).toBe(250);
	});

	it('take no step from the smallest base', () => {
		const { controller, ladder } = controlled(950);
		controller.setBloom(true, SMALLEST_BLOOM_SIZE);
		expect(ladder(SLOW)).toEqual(['950 1 3']);
		expect(controller.maxSteps).toBe(0);
		expect(SMALLEST_BLOOM_SIZE).toBe(64);
	});
});

describe('the governor in the frame loop', () => {
	/** Safari's worker timer: its period, how late it fires every third time, and its calls. */
	const TIMER_MS = 15.4;
	const TIMER_LATE_MS = 1.5;
	const TIMER_CALLS = 2000;

	/**
	 * A metrics buffer whose render and completion rings the test writes as frames go, and a scene
	 * whose shadows and loading the test sets.
	 */
	function loop(refreshHz = 60, fps?: number) {
		const metrics = createMetricsBuffer(false, 0);
		const render = new FrameRecorder(metrics, Role.Render);
		const done = new FrameRecorder(metrics, Role.Completion);
		render.setRefreshHz(refreshHz);
		const scene = { casters: 0, loading: false };
		const reads: GovernorScene = {
			shadowCasters: () => scene.casters,
			loading: () => scene.loading,
		};
		const resolution = new GovernorLoop(new Governor(), metrics, reads, fps);
		resolution.governor.setRange(500, FULL_SCALE);
		let now = 0;
		let frame = 0;
		/**
		 * Steps frames `interval` ms apart for `ms`, or with the intervals of a list in turn, the GPU
		 * taking `delay` for each.
		 */
		const run = (interval: number | readonly number[], delay: number, ms: number): number => {
			const intervals = typeof interval === 'number' ? [interval] : interval;
			for (const end = now + ms; now < end; ) {
				const gap = intervals[frame % intervals.length] as number;
				now += gap;
				frame++;
				render.begin(frame);
				render.interval(gap);
				render.commit(1);
				done.begin(frame);
				done.interval(gap);
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

	it('keeps the rest of its grace after a stall early in play', () => {
		// A stall long enough to start the windows again, as when a driver compiles the shaders of
		// objects added during play at their first draw, comes before the grace ends.
		const { run } = loop();
		run(2 * BUDGET, BUDGET, 400);
		run(GAP_MS + 100, BUDGET, GAP_MS + 100);
		expect(run(2 * BUDGET, BUDGET, GRACE_MS + DROP_AFTER_MS - 2 * WINDOW_MS - 1000)).toBe(
			FULL_SCALE,
		);
		expect(run(2 * BUDGET, BUDGET, 2 * WINDOW_MS)).toBe(FULL_SCALE - SCALE_STEP);
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

	it("steps up with the frames that Safari's worker timer paces to the display", () => {
		// Safari runs a worker's frame callbacks from a timer about 64 times a second, and the timer
		// fires a little late now and then. Held to a 60 Hz display, about every 16th callback draws
		// nothing, and the next frame comes two callbacks after the last. A quarter second holds one
		// or two such gaps, so its mean interval varies around the budget, at 60 frames per second in
		// all. On the Mac, the windows measured 97% to 105% of the budget in Safari.
		const pacer = new FramePacer(undefined);
		pacer.holdToDisplay(BUDGET);
		const times: number[] = [];
		for (let call = 1; call <= TIMER_CALLS; call++) {
			const time = call * TIMER_MS + (call % 3 === 0 ? TIMER_LATE_MS : 0);
			if (pacer.take(time)) times.push(time);
		}
		const intervals = times.slice(1).map((time, k) => time - (times[k] as number));
		const seconds = ((times.at(-1) as number) - (times[0] as number)) / 1000;
		expect(intervals.length / seconds).toBeCloseTo(60, 1);
		expect(Math.max(...intervals)).toBeGreaterThan(1.8 * BUDGET);
		const { run, resolution } = loop();
		resolution.governor.scale = 900;
		run(intervals, BUDGET / 4, GRACE_MS + 1000);
		expect(run(intervals, BUDGET / 4, RAISE_AFTER_MS)).toBe(950);
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
		scene.casters = 3 | SHADOW_CASTERS_TILES;
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

/** The seconds of a trace, written as a run's per-second rates. */
const seconds = (rates: string) => rates.split(' ').map(Number);

/**
 * Replays a run on a device for `total` seconds. Each second's frames come at the rate that `next`
 * gives for the governor's scale and the scale of the second before, and the GPU finishes each
 * frame within one. Returns each second's rate and the scale it drew at.
 */
function replay(start: number, total: number, next: (scale: number, before: number) => number) {
	const { controller, run } = controlled(500, FULL_SCALE, start);
	const out: { fps: number; scale: number }[] = [];
	let before = start;
	for (let k = 0; k < total; k++) {
		const scale = controller.scale;
		const fps = next(scale, before);
		before = scale;
		run(atRate(fps), 1000);
		out.push({ fps, scale });
	}
	return out;
}

/** The seconds of a replay that held the target, and its moves between two scales. */
function judgeReplay(out: { fps: number; scale: number }[], low: number, high: number) {
	const held = out.filter(({ fps }) => holds(fps)).length;
	const moves = out.filter((second, k) => {
		const last = out[k - 1]?.scale;
		return (
			last !== undefined &&
			second.scale !== last &&
			Math.min(second.scale, last) === low &&
			Math.max(second.scale, last) === high
		);
	}).length;
	return { held, moves, lowest: Math.min(...out.map(({ scale }) => scale)) };
}

describe("replays of the iPad's S4 runs at Low", () => {
	// Safari 26.6.2 on WebGPU, warm, at render scale 0.85: 54 to 57 frames per second for minutes.
	// The run held the target in 49 of its 300 seconds. At 0.8 it ran at 57 to 60.
	const webgpu = {
		850: seconds(
			'54 56 55 56 56 56 57 56 55 55 55 55 55 54 56 55 56 57 56 56 56 55 56 55 55 55 55 55 55 55 56 55 56 56 57 57 57 56 56 57 55 56 55 55 55 55 56 55 56 56 55 56 56 55 55 55 55 55 54 ' +
				'55 55 56 55 55 56 55 55 55 55 55 56 56 57 57 57 57 56 57 55 55 55 55 55 56 55 56 55 56 55 56 55 56 55 55 55 54 55 54 55 55 56 56 56 56 56 54 56 55 55 55 55 55 55 55 56 56 56 56 56 55 56 55 55 56 55 55 55 55 55 56 55 57 56 57 57 57 56 57 55 55 55 55 56 55 55 56 55 56 56 55 56 55 56 54 55 55 54 55 55 55 56 56 56 56 56 56 55 55 55 55 55 55 55 55 56 57 56 56 56 55 56 55 55 56 55 55 55 55 55 56 55 57 56 57 57 57 56 57 55 56 55 55 55 55 56 55 56 56 55 56 55 56 55 55 55 54 55 54 55 56 55 56 56 57 56 56 55 55 55 55 55 55 55 55 56 56 56 57 55 56 55 56 55 55 55 55 55 55 55 56 55 56 57 56 57 57 56 57 55 56 55 54 56 55 55 56 55 56 56 55 56 55 56 54 55 55 54 55',
		),
		800: seconds('57 58 58 59 59 60 59 59 58 58 58 57 58 58 58 58 59 60 59 59'),
	};

	it('holds the target on WebGPU in at least 95% of the seconds', () => {
		// The scales above 0.85 ran slower in the warm-up, and those under 0.8 are taken to hold
		// the full rate, as 0.8 nearly did. Each scale's seconds play on from where they stopped.
		const played = new Map<number, number>();
		const out = replay(850, 300, (scale) => {
			if (scale > 850) return 50;
			if (scale < 800) return 60;
			const rates = webgpu[scale as 850 | 800];
			const second = played.get(scale) ?? 0;
			played.set(scale, second + 1);
			return rates[second % rates.length] as number;
		});
		const { held, moves, lowest } = judgeReplay(out, 800, 850);
		// 297 of the 300 seconds: one step down at once, and one failed try of 0.85. The frames at
		// 0.8 then hold the target without the room for a step up.
		expect(held).toBeGreaterThanOrEqual(0.95 * out.length);
		expect(lowest).toBe(800);
		expect(moves).toBeLessThanOrEqual(3);
		expect(out.slice(-240).every(({ scale }) => scale === 800)).toBe(true);
	});

	// Safari 26.6.2 on WebGL2, warm: at 0.65, the frames held the target at first after each step
	// up, then fell behind 9 to 15 seconds later. The run moved between 0.6 and 0.65 nine times.
	const webgl2 = {
		650: [
			'59 61 60 60 59 60 59 60 57 60 60 60 59 60 61 60 59 60 60 60 59 60 60 60 60 59 60 60 59 60 60 60 60 59 60 61 59 59 61 59 60 60 59 60 60 61 60 58 60 60 61 59 60 60 60 60 59 60 59 60 61 59 59 60 61 59 60 60 59 60 60 60 61 59 60 61 59 60 60 59 59 57 59 60 59 59 58 58 59 60 60 59 60 57 55 55',
			'60 59 59 57 59 59 58 59 60 60 60 60 57 56',
			'59 60 60 60 58 59 60 61 59 60 61 60 60 57',
			'59 59 58 57 58 58 55 60 56',
			'60',
		].map(seconds),
		600: seconds(
			'60 60 59 60 60 61 59 59 60 60 60 60 59 61 60 59 60 60 60 59 60 60 60 59 59 60 60 59 60 60 60 59 60 60 59 61 60 60 60 59 60 60 60 60 59 61 60 60 59 60 60 61 60 60 60 60 ' +
				'60 59 60 60 61 59 60 60 60 61 59 60 60 60 60 59 59 61 60 60 59 61 60 59 60 60 61 59 59 61 60 60 59 60 60 60 59 60 60 59 60 61 60 60 60 60 ' +
				'59 60 60 60 59 60 60 59 60 60 60 60 60 59 60 60 60 61 59 60 60 59 60 60 60 60 60 60 59 60 60 60 61 59 60 60 60 60 60 60 60 59 60 59 60 58 60 60 60 59 60 60 61 59 60',
		),
	};

	it('tries the higher of two scales less and less often on WebGL2 when it fails late', () => {
		// Each step up from 0.6 to 0.65 replays the run's next visit of 0.65, and then falls to 56
		// frames per second, as the frames did before each step down in the run. A step back down
		// to 0.65 from above goes on with the visit.
		let visit = 0;
		let second = 0;
		let played600 = 0;
		const out = replay(650, 2 * 300, (scale, before) => {
			if (scale > 650) return 50;
			if (scale < 600) return 60;
			if (scale === 600) return webgl2[600][played600++ % webgl2[600].length] as number;
			if (before === 600) {
				visit = Math.min(visit + 1, webgl2[650].length - 1);
				second = 0;
			}
			const rates = webgl2[650][visit] as number[];
			return second < rates.length ? (rates[second++] as number) : 56;
		});
		const { held, lowest } = judgeReplay(out, 600, 650);
		// 583 of the 600 seconds, counting the failed tries of 0.7, whose rate the run never measured.
		expect(held).toBeGreaterThanOrEqual(0.95 * out.length);
		expect(lowest).toBe(600);
		// The run moved between the two scales nine times in 300 seconds, and stayed at 0.6 for 13 to
		// 45 seconds before each try.
		// Here each stay at 0.6 is twice as long as the one before, up to the longest wait.
		const stays: number[] = [];
		out.forEach(({ scale }, k) => {
			if (scale !== 600) return;
			if (out[k - 1]?.scale !== 600) stays.push(0);
			stays[stays.length - 1] = (stays.at(-1) as number) + 1;
		});
		const full = stays.slice(0, -1);
		full.slice(1).forEach((stay, k) => {
			expect(stay).toBeGreaterThanOrEqual(Math.min(2 * (full[k] as number) - 2, 80));
		});
		expect(Math.min(...full.slice(-3))).toBeGreaterThanOrEqual(LONGEST_RAISE_AFTER_MS / 1000);
	});
});
