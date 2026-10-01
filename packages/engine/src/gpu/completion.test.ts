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
	const queue = {
		onSubmittedWorkDone: () => new Promise<void>((resolve) => waiting.push(resolve)),
	};
	/** The GPU finishes the next `count` frames now; the promises settle on the next microtasks. */
	const finish = async (count: number) => {
		for (const resolve of waiting.splice(0, count)) resolve();
		await Promise.resolve();
		await Promise.resolve();
	};
	return { queue: queue as unknown as GPUQueue, finish };
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

	it('stops counting a frame the GPU has not finished after a second, so drawing goes on', () => {
		const { gl } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		completions.afterSubmit(1);
		now = 500;
		completions.afterSubmit(2);
		now = 999;
		expect(completions.unfinished()).toBe(2);
		now = 1001;
		expect(completions.unfinished()).toBe(1);
		now = 1501;
		expect(completions.unfinished()).toBe(0);
	});

	it('counts the frames behind a completion for a second after it, however long they waited', () => {
		const { gl, finish } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		completions.afterSubmit(1);
		now = 100;
		completions.afterSubmit(2);
		now = 600;
		finish(1);
		expect(completions.unfinished()).toBe(1);
		now = 1500;
		expect(completions.unfinished()).toBe(1);
		now = 1601;
		expect(completions.unfinished()).toBe(0);
	});

	it('leaves a frame untracked when every slot holds an unfinished one', () => {
		const { gl, fences } = fakeGl();
		const completions = new FenceCompletion(gl, createMetricsBuffer(false, 0));
		for (let frame = 1; frame <= 10; frame++) completions.afterSubmit(frame);
		expect(fences).toHaveLength(8);
		expect(completions.unfinished()).toBe(8);
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
});

describe('the frame windows that the quality governor reads', () => {
	/**
	 * A GPU that finishes one frame every `gpuMs`, fed by a thread that submits a frame whenever
	 * fewer than two are unfinished, at each callback of a 60 Hz display. Returns the frames
	 * submitted, the completed rate, and the mean and longest time from submit to completion in each
	 * one-second window.
	 */
	async function windows(gpuMs: number, seconds: number) {
		const metrics = createMetricsBuffer(false, 0);
		const sums = new RingSums(metrics, Role.Completion);
		const { queue, finish } = fakeQueue();
		const completions = new QueueCompletion(queue, metrics);
		const callbackMs = 1000 / 60;
		const results: { submitted: number; fps: number; latencyMs: number; longestMs: number }[] = [];
		let frame = 0;
		let submittedBefore = 0;
		let nextDone = Number.POSITIVE_INFINITY;
		for (let callback = 1; callback <= seconds * 60; callback++) {
			const at = callback * callbackMs;
			// The GPU finishes its queued frames up to this callback, one every gpuMs.
			while (nextDone <= at) {
				now = nextDone;
				await finish(1);
				nextDone = completions.unfinished() > 0 ? nextDone + gpuMs : Number.POSITIVE_INFINITY;
			}
			now = at;
			if (completions.unfinished() < 2) {
				completions.afterSubmit(++frame);
				if (nextDone === Number.POSITIVE_INFINITY) nextDone = at + gpuMs;
			}
			sums.add();
			if (callback % 60 === 0) {
				const s = sums.sums;
				results.push({
					submitted: frame - submittedBefore,
					fps: (1000 * (s[SUM_RECORDS] as number)) / (s[SUM_INTERVAL_MS] as number),
					latencyMs: (s[SUM_BUSY_MS] as number) / (s[SUM_RECORDS] as number),
					longestMs: s[SUM_LONGEST_BUSY_MS] as number,
				});
				submittedBefore = frame;
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

	it('holds two frames in flight when each takes most of a second', async () => {
		const gpuMs = 600;
		const results = (await windows(gpuMs, 10)).slice(1);
		let submitted = 0;
		let completed = 0;
		for (const { submitted: frames, fps, longestMs } of results) {
			submitted += frames;
			completed += fps;
			expect(longestMs).toBeLessThanOrEqual(2 * gpuMs);
		}
		// The thread submits frames no faster than the GPU finishes them.
		expect(Math.abs(submitted - completed)).toBeLessThan(1);
	});
});
