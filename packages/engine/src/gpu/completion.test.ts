import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
	createMetricsBuffer,
	RingSums,
	Role,
	SUM_BUSY_MS,
	SUM_INTERVAL_MS,
	SUM_LONGEST_BUSY_MS,
	SUM_RECORDS,
} from '../shared/metrics';
import { FenceCompletion, QueueCompletion } from './completion';

/** The time that `performance.now` gives, which the tests move. */
let now = 0;

beforeEach(() => {
	now = 0;
	spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => mock.restore());

const SIGNALED = 0x9119;
const UNSIGNALED = 0x9118;

/** A WebGL2 context whose fences signal when the test says so, oldest first. */
function fakeGl() {
	const fences: { signaled: boolean; deleted: boolean }[] = [];
	const gl = {
		SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
		SYNC_STATUS: 0x9114,
		SIGNALED,
		fenceSync() {
			const fence = { signaled: false, deleted: false };
			fences.push(fence);
			return fence;
		},
		flush() {},
		getSyncParameter: (fence: { signaled: boolean }) => (fence.signaled ? SIGNALED : UNSIGNALED),
		deleteSync(fence: { deleted: boolean }) {
			fence.deleted = true;
		},
	};
	/** The GPU finishes the next `count` frames now. */
	const finish = (count: number) => {
		for (const fence of fences.filter((f) => !f.signaled).slice(0, count)) fence.signaled = true;
	};
	return { gl: gl as unknown as WebGL2RenderingContext, fences, finish };
}

/** A queue whose submitted work finishes when the test says so, oldest first. */
function fakeQueue() {
	const waiting: (() => void)[] = [];
	/** The promises that the tracker asked for: one for each frame it tracks. */
	const asked = { count: 0 };
	const queue = {
		onSubmittedWorkDone: () => {
			asked.count++;
			return new Promise<void>((resolve) => waiting.push(resolve));
		},
	};
	/** The GPU finishes the next `count` frames now; the promises settle on the next microtasks. */
	const finish = async (count: number) => {
		for (const resolve of waiting.splice(0, count)) resolve();
		await Promise.resolve();
		await Promise.resolve();
	};
	return { queue: queue as unknown as GPUQueue, finish, asked };
}

describe('the WebGL2 completion tracker', () => {
	it('tracks every frame while the page is not measuring, and records each completion', () => {
		const metrics = createMetricsBuffer(false, 0);
		const sums = new RingSums(metrics, Role.Completion);
		const { gl, fences, finish } = fakeGl();
		const completions = new FenceCompletion(gl, metrics);
		for (let frame = 1; frame <= 4; frame++) {
			now = frame * 10;
			completions.afterSubmit(frame);
		}
		expect(fences).toHaveLength(4);
		expect(completions.unfinished()).toBe(4);
		now = 45;
		finish(1);
		expect(completions.unfinished()).toBe(3);
		now = 65;
		finish(2);
		expect(completions.unfinished()).toBe(1);
		expect(fences.map((fence) => fence.deleted)).toEqual([true, true, true, false]);
		sums.add();
		// The first completion has no earlier one to measure an interval from, so it leaves no
		// record. Frames 2 and 3 left the GPU together, 45 and 35 ms after their submits, and share
		// the 20 ms since frame 1.
		expect(sums.sums[SUM_RECORDS]).toBe(2);
		expect(sums.sums[SUM_BUSY_MS]).toBe(80);
		expect(sums.sums[SUM_LONGEST_BUSY_MS]).toBe(45);
		expect(sums.sums[SUM_INTERVAL_MS]).toBe(20);
	});

	it('gives up a frame the GPU has not finished after a second, so drawing goes on', () => {
		const { gl } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		completions.afterSubmit(1);
		now = 500;
		completions.afterSubmit(2);
		now = 999;
		expect(completions.unfinished()).toBe(2);
		now = 1001;
		expect(completions.unfinished()).toBe(1);
		// The GPU takes the second frame only once it is done with the first, so the second frame's
		// time runs from the moment the first was given up. A second frame given up with no
		// completion between doubles the time, to 2 s.
		now = 2999;
		expect(completions.unfinished()).toBe(1);
		now = 3001;
		expect(completions.unfinished()).toBe(0);
	});

	it('counts the frames behind a completion for a second after it, however long they waited', () => {
		const { gl, finish } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		completions.afterSubmit(1);
		now = 100;
		completions.afterSubmit(2);
		now = 200;
		finish(1);
		expect(completions.unfinished()).toBe(1);
		now = 1199;
		expect(completions.unfinished()).toBe(1);
		now = 1201;
		expect(completions.unfinished()).toBe(0);
	});

	it('waits four of the slowest recent frame times for a GPU slower than a second a frame', () => {
		const { gl, finish } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		for (let frame = 1; frame <= 4; frame++) completions.afterSubmit(frame);
		now = 1500;
		finish(1);
		expect(completions.unfinished()).toBe(3);
		// A quick frame after a slow one leaves the slow one's time as the measure.
		now = 1700;
		finish(1);
		expect(completions.unfinished()).toBe(2);
		now = 3000;
		finish(1);
		expect(completions.unfinished()).toBe(1);
		// The browser reports no more completions: the frame counts until four of the slowest frame
		// times, 1.5 s each, pass.
		now = 8999;
		expect(completions.unfinished()).toBe(1);
		now = 9001;
		expect(completions.unfinished()).toBe(0);
	});

	it('leaves a frame untracked when every slot holds an unfinished one', () => {
		const { gl, fences } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		for (let frame = 1; frame <= 10; frame++) completions.afterSubmit(frame);
		expect(fences).toHaveLength(8);
		expect(completions.unfinished()).toBe(8);
	});

	it('tracks every frame it lets through while the browser reports no completion', () => {
		const { gl, fences } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		let submitted = 0;
		// A thread that draws whenever fewer than two frames are unfinished, at 60 Hz for 60 s.
		for (let callback = 0; callback < 60 * 60; callback++) {
			now = (callback * 1000) / 60;
			if (completions.unfinished() < 2) completions.afterSubmit(++submitted);
		}
		// Each frame gets a fence. The tracker gives up frames after 1, 2, 4 and then every 8 s, at
		// 1, 3, 7, 15, 23, 31, 39, 47 and 55 s, so the drawing slows but goes on. Frames given up
		// while every slot is taken lose their fence.
		expect(fences).toHaveLength(submitted);
		expect(submitted).toBe(2 + 9);
		expect(fences.filter((fence) => fence.deleted).length).toBeGreaterThanOrEqual(3);
	});
});

describe('the WebGPU completion tracker', () => {
	it('counts the frames whose work the queue has not finished', async () => {
		const metrics = createMetricsBuffer(false, 0);
		const sums = new RingSums(metrics, Role.Completion);
		const { queue, finish } = fakeQueue();
		const completions = new QueueCompletion(queue, metrics);
		completions.afterSubmit(1);
		completions.afterSubmit(2);
		expect(completions.unfinished()).toBe(2);
		now = 30;
		await finish(1);
		expect(completions.unfinished()).toBe(1);
		await finish(1);
		expect(completions.unfinished()).toBe(0);
		sums.add();
		expect(sums.sums[SUM_RECORDS]).toBe(1);
	});

	it('tracks every frame it lets through, and skips the promises of frames it forgot', async () => {
		const metrics = createMetricsBuffer(false, 0);
		const sums = new RingSums(metrics, Role.Completion);
		const { queue, finish, asked } = fakeQueue();
		const completions = new QueueCompletion(queue, metrics);
		let submitted = 0;
		// The queue settles nothing for 60 s, while a thread draws whenever fewer than two frames
		// are unfinished, at 60 Hz.
		for (let callback = 0; callback < 60 * 60; callback++) {
			now = (callback * 1000) / 60;
			if (completions.unfinished() < 2) completions.afterSubmit(++submitted);
		}
		expect(asked.count).toBe(submitted);
		expect(submitted).toBe(11);
		// The queue then settles every frame in order. The forgotten frames' promises come first and
		// leave no record, so the tracked frames finish in turn and none is left unfinished.
		await finish(submitted);
		expect(completions.unfinished()).toBe(0);
		sums.add();
		expect(sums.sums[SUM_RECORDS]).toBeLessThanOrEqual(8);
	});
});

describe('the frame windows that the quality governor reads', () => {
	/**
	 * A GPU that needs `gpuMs` for each frame, fed by a thread that submits a frame whenever fewer
	 * than two are unfinished, at each callback of a 60 Hz display. A list of frame times repeats,
	 * one entry a frame. `firstMs`, when given, is the first frame's time instead, as when a software
	 * GPU builds the first frame's pipelines while it draws it. Returns, for each one-second window,
	 * the frames submitted, tracked and completed, the completed rate, the mean and longest time
	 * from submit to completion, and the most frames that waited on the GPU at once.
	 */
	async function windows(gpuMs: number | readonly number[], seconds: number, firstMs?: number) {
		const frameMs = typeof gpuMs === 'number' ? [gpuMs] : gpuMs;
		const metrics = createMetricsBuffer(false, 0);
		const sums = new RingSums(metrics, Role.Completion);
		const { queue, finish, asked } = fakeQueue();
		const completions = new QueueCompletion(queue, metrics);
		const callbackMs = 1000 / 60;
		const results: {
			submitted: number;
			tracked: number;
			completed: number;
			fps: number;
			latencyMs: number;
			longestMs: number;
			mostInFlight: number;
		}[] = [];
		let frame = 0;
		let done = 0;
		let submittedBefore = 0;
		let mostInFlight = 0;
		let nextDone = Number.POSITIVE_INFINITY;
		/** When the GPU, starting at `at`, finishes the oldest frame that it has not finished. */
		const doneAfter = (at: number) =>
			at +
			(done === 0 && firstMs !== undefined ? firstMs : (frameMs[done % frameMs.length] as number));
		for (let callback = 1; callback <= seconds * 60; callback++) {
			const at = callback * callbackMs;
			// The GPU finishes its queued frames up to this callback, one after another.
			while (nextDone <= at) {
				now = nextDone;
				await finish(1);
				done++;
				nextDone = frame > done ? doneAfter(nextDone) : Number.POSITIVE_INFINITY;
			}
			now = at;
			if (completions.unfinished() < 2) {
				completions.afterSubmit(++frame);
				if (nextDone === Number.POSITIVE_INFINITY) nextDone = doneAfter(at);
				mostInFlight = Math.max(mostInFlight, frame - done);
			}
			sums.add();
			if (callback % 60 === 0) {
				const s = sums.sums;
				results.push({
					submitted: frame - submittedBefore,
					tracked: asked.count,
					completed: s[SUM_RECORDS] as number,
					fps: (1000 * (s[SUM_RECORDS] as number)) / (s[SUM_INTERVAL_MS] as number),
					latencyMs: (s[SUM_BUSY_MS] as number) / (s[SUM_RECORDS] as number),
					longestMs: s[SUM_LONGEST_BUSY_MS] as number,
					mostInFlight,
				});
				submittedBefore = frame;
				mostInFlight = 0;
				sums.clear();
			}
		}
		return results;
	}

	it('holds completions in every window while the GPU keeps up', async () => {
		for (const { fps, latencyMs } of await windows(5, 4)) {
			expect(fps).toBeCloseTo(60, 0);
			expect(latencyMs).toBeCloseTo(5, 0);
		}
	});

	it('shows the slower completed rate and the longer delay when the GPU falls behind', async () => {
		const results = await windows(40, 4);
		for (const { fps, latencyMs } of results.slice(1)) {
			expect(fps).toBeCloseTo(25, 0);
			// Two frames wait at most: a frame's delay stays under two of the GPU's frame times.
			expect(latencyMs).toBeGreaterThan(40);
			expect(latencyMs).toBeLessThan(80);
		}
	});

	/**
	 * Checks that after the first windows, at most two frames wait on the GPU at once, so each frame
	 * waits at most two of the GPU's frame times, and the thread submits frames no faster than the
	 * GPU finishes them.
	 */
	async function holdsTwo(gpuMs: number | readonly number[], seconds: number, skip: number) {
		const slowestMs = typeof gpuMs === 'number' ? gpuMs : Math.max(...gpuMs);
		const results = (await windows(gpuMs, seconds)).slice(skip);
		let submitted = 0;
		let completed = 0;
		for (const window of results) {
			submitted += window.submitted;
			completed += window.completed;
			expect(window.mostInFlight).toBeLessThanOrEqual(2);
			expect(window.longestMs).toBeLessThanOrEqual(2 * slowestMs);
		}
		expect(Math.abs(submitted - completed)).toBeLessThanOrEqual(2);
		return results;
	}

	it('holds two frames in flight when each takes most of a second', () => holdsTwo(600, 10, 1));

	// Until the first completion, the tracker cannot tell a slow GPU from a lost completion, so
	// a few frames go in at first and take some windows to finish.
	it('holds two frames in flight when each takes more than a second', () => holdsTwo(1200, 30, 10));

	it('holds two frames in flight when a quick frame comes before a slow one', () =>
		holdsTwo([700, 700, 150, 1150], 30, 1));

	it("holds two frames in flight on a GPU whose frame times vary as CI's software GPU's", async () => {
		// A completion about every 0.72 s, as CI's software GPU gives at the GPU-bound page's first
		// step, with frame times from 0.3 to 1.2 s.
		const results = await holdsTwo([640, 780, 420, 1160, 700, 560, 980, 300, 1050, 710], 60, 1);
		const completed = results.reduce((sum, window) => sum + window.completed, 0);
		expect(completed / results.length).toBeCloseTo(1000 / 730, 1);
	});

	it('holds two frames in flight when a frame takes almost four times as long as those before', () =>
		holdsTwo([400, 400, 400, 400, 400, 400, 400, 1550], 60, 1));

	it('tracks every frame and soon holds two in flight when the first frame takes seconds', async () => {
		// CI's software GPU builds the first frame's pipelines while it draws that frame, 4.3 s on a
		// busy runner, and then draws a frame in about 0.7 s. Until the first completion, the tracker
		// gave up a frame each second, and once its slots were full, frames that it could not track
		// went in at every callback. They kept the GPU busy for seconds, and the benchmark measured
		// no frame. Now it gives up frames after 1 and 3 s, so four frames wait at most.
		const results = await windows(700, 30, 4300);
		const last = results[results.length - 1];
		expect(last?.tracked).toBe(results.reduce((sum, window) => sum + window.submitted, 0));
		expect(Math.max(...results.map((window) => window.mostInFlight))).toBeLessThanOrEqual(4);
		// Once the GPU has drawn the frames that went in during the first frame, every second
		// completes frames, and two frames at most wait on the GPU.
		for (const window of results.slice(10)) {
			expect(window.completed).toBeGreaterThan(0);
			expect(window.mostInFlight).toBeLessThanOrEqual(2);
		}
	});
});
