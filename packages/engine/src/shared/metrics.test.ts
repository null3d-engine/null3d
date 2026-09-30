import { describe, expect, it } from 'bun:test';
import { CORE_NOT_COUNTED } from '../generated/core';
import { gpuPassStats, summarizeFrames, threadRoles, timerStep } from '../page/frame-stats';
import {
	Counter,
	createMetricsBuffer,
	FrameRecorder,
	GPU_TIMED_PASSES,
	MetricsReader,
	Phase,
	type RingRecords,
	Role,
	UNTIMED,
} from './metrics';
import { ratePerSecond } from './stats';

function record(recorder: FrameRecorder, frame: number, busy: number, update = 0): void {
	recorder.begin(frame);
	if (update > 0) recorder.addPhase(Phase.Update, update);
	recorder.commit(busy);
}

describe('frame records', () => {
	it('carry times, phases, counters and intervals from the writer to the reader', () => {
		const buffer = createMetricsBuffer(true, 2);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const render = new FrameRecorder(buffer, Role.Render);
		render.begin(7);
		render.addPhase(Phase.Upload, 0.25);
		render.addPhase(Phase.Replay, 0.5);
		render.addPhase(Phase.Replay, 0.25);
		render.count(Counter.DrawCalls, 12);
		render.count(Counter.UploadBytes, 4800);
		render.interval(16.5);
		render.commit(1.5);
		reader.drain();
		const out = reader.records[Role.Render];
		expect(out?.frames).toEqual([7]);
		expect(out?.busy).toEqual([1.5]);
		expect(out?.intervals).toEqual([16.5]);
		expect(out?.phases[Phase.Upload]).toEqual([0.25]);
		expect(out?.phases[Phase.Replay]).toEqual([0.75]);
		expect(out?.counters[Counter.DrawCalls]).toEqual([12]);
		expect(out?.counters[Counter.UploadBytes]).toEqual([4800]);
		expect(reader.lost).toBe(0);
	});

	it('skip records written before the measurement began', () => {
		const buffer = createMetricsBuffer(false, 0);
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		record(sketch, 1, 1);
		const reader = new MetricsReader(buffer);
		reader.begin();
		record(sketch, 2, 2);
		reader.end();
		expect(reader.records[Role.Sketch]?.frames).toEqual([2]);
	});

	it('count records the writer overwrote before the reader drained them', () => {
		const buffer = createMetricsBuffer(true, 0, 4);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		for (let frame = 1; frame <= 10; frame++) record(sketch, frame, frame);
		reader.drain();
		expect(reader.records[Role.Sketch]?.frames).toEqual([7, 8, 9, 10]);
		expect(reader.lost).toBe(6);
	});

	it('drop a record that is being rewritten while the reader reads it', () => {
		const buffer = createMetricsBuffer(true, 0, 4);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		for (let frame = 1; frame <= 4; frame++) record(sketch, frame, frame);
		// The writer starts the fifth record in the slot of the first and has not finished it.
		sketch.begin(5);
		reader.drain();
		expect(reader.records[Role.Sketch]?.frames).toEqual([2, 3, 4]);
		expect(reader.lost).toBe(1);
	});

	it('turn costly timing on only while the page measures', () => {
		const buffer = createMetricsBuffer(true, 0);
		const gpu = new FrameRecorder(buffer, Role.Gpu);
		const reader = new MetricsReader(buffer);
		expect(gpu.measuring).toBe(false);
		reader.begin();
		expect(gpu.measuring).toBe(true);
		reader.end();
		expect(gpu.measuring).toBe(false);
	});

	it('keep the time of the first frame only', () => {
		const buffer = createMetricsBuffer(true, 0);
		const render = new FrameRecorder(buffer, Role.Render);
		const reader = new MetricsReader(buffer);
		expect(reader.firstFrameTime).toBe(0);
		render.markFirstFrame();
		const first = reader.firstFrameTime;
		render.markFirstFrame();
		expect(first).toBeGreaterThan(0);
		expect(reader.firstFrameTime).toBe(first);
	});

	it('refuse a ring the buffer does not have', () => {
		expect(() => new FrameRecorder(createMetricsBuffer(true, 1), Role.Job + 1)).toThrow('no ring');
	});
});

describe('threadRoles', () => {
	it('places the sketch and render roles on the threads of each mode', () => {
		const roles = (latency: string, renderThread: string, jobWorkers = 0) =>
			Object.fromEntries(threadRoles({ latency, renderThread, jobWorkers }));
		expect(roles('pipelined', 'render-worker', 2)).toEqual({
			'sketch-worker': [Role.Sketch],
			'render-worker': [Role.Render],
			'job-0': [Role.Job],
			'job-1': [Role.Job + 1],
		});
		expect(roles('pipelined', 'main')).toEqual({
			'sketch-worker': [Role.Sketch],
			main: [Role.Render],
		});
		expect(roles('low', 'sketch-worker')).toEqual({ 'sketch-worker': [Role.Sketch, Role.Render] });
		expect(roles('single', 'main')).toEqual({ main: [Role.Sketch, Role.Render] });
	});
});

describe('summarizeFrames', () => {
	/** Frames with these latency mode and drawing thread; the sketch counts `visible(frame)` entries. */
	function run(
		latency: string,
		renderThread: string,
		visible: (frame: number) => number = (frame) => 100 * frame,
	) {
		const buffer = createMetricsBuffer(true, 1);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		const render = new FrameRecorder(buffer, Role.Render);
		const job = new FrameRecorder(buffer, Role.Job);
		const gpu = new FrameRecorder(buffer, Role.Gpu);
		const completion = new FrameRecorder(buffer, Role.Completion);
		for (const [frame, busy] of [
			[1, 1],
			[2, 2],
			[3, 3],
			[4, 1],
		] as const) {
			sketch.begin(frame);
			sketch.addPhase(Phase.Update, busy);
			// Only the first frame rebuilt its draw tables.
			sketch.count(Counter.Rebuilds, frame === 1 ? 1 : 0);
			sketch.count(Counter.VisibleEntries, visible(frame));
			sketch.commit(busy);
			record(job, frame, 0.5);
		}
		for (const frame of [1, 2, 3]) {
			render.begin(frame);
			render.interval(frame === 1 ? 0 : 16);
			render.count(Counter.DrawCalls, 10);
			render.commit(2);
			record(gpu, frame, 0.1 * frame);
			// The GPU finishes each frame 4 ms after its submit, 32 ms apart: half the presented rate.
			completion.begin(frame);
			completion.interval(frame === 1 ? 0 : 32);
			completion.commit(4);
		}
		reader.end();
		return summarizeFrames(reader.records, threadRoles({ latency, renderThread, jobWorkers: 1 }));
	}

	it('takes the busiest thread per frame, and joins frames the renderer drew', () => {
		const summary = run('pipelined', 'render-worker');
		expect(summary.frames).toBe(3);
		// Per frame: sketch 1, 2, 3; render 2, 2, 2; job 0.5 each.
		expect(summary.cpuMs.median).toBe(2);
		expect(summary.cpuMs.p99).toBeCloseTo(2.98, 9);
		expect(summary.cpuMsAllThreads.median).toBe(4.5);
		expect(Object.keys(summary.threads).sort()).toEqual([
			'job-0',
			'render-worker',
			'sketch-worker',
		]);
		expect(summary.threads['sketch-worker']?.phases.update?.median).toBe(2);
		expect(summary.intervalMs).toMatchObject({ count: 2, median: 16 });
		expect(summary.drawCalls.median).toBe(10);
		expect(summary.gpuMs?.count).toBe(3);
		expect(summary.gpuStepMs).toBeCloseTo(0.1, 6);
		expect(summary.presentedFps).toBeCloseTo(62.5, 6);
		expect(summary.completedFps).toBeCloseTo(31.25, 6);
		expect(summary.gpuLatencyMs).toMatchObject({ count: 3, median: 4 });
		expect(summary.rebuilds).toBe(1);
		// Every frame the sketch computed counts its entries: 100, 200, 300 and 400.
		expect(summary.visibleEntries).toMatchObject({ count: 4, median: 250 });
	});

	it('reports no visible entries where the GPU culls', () => {
		expect(run('pipelined', 'render-worker', () => CORE_NOT_COUNTED).visibleEntries).toBeNull();
	});

	it('adds up roles that share a thread', () => {
		const summary = run('low', 'sketch-worker');
		// The sketch worker also draws: 1 + 2, 2 + 2, 3 + 2.
		expect(summary.cpuMs.median).toBe(4);
		expect(summary.threads['sketch-worker']?.busyMs.median).toBe(4);
	});
});

describe('gpuPassStats', () => {
	/** Reads back GPU records of frames whose passes are render passes where `render` says so. */
	function gpuRecords(
		frames: { copies: number; passes: number[]; render: boolean[]; frameMs: number }[],
	) {
		const buffer = createMetricsBuffer(false, 0);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const gpu = new FrameRecorder(buffer, Role.Gpu);
		frames.forEach(({ copies, passes, render, frameMs }, index) => {
			gpu.begin(index + 1);
			let renderPasses = 0;
			render.forEach((isRender, pass) => {
				if (isRender) renderPasses |= 1 << pass;
			});
			gpu.gpuPasses(passes.length, renderPasses);
			gpu.gpuTime(0, copies);
			passes.slice(0, GPU_TIMED_PASSES).forEach((ms, pass) => {
				gpu.gpuTime(1 + pass, ms);
			});
			gpu.commit(frameMs);
		});
		reader.end();
		return reader.records[Role.Gpu] as RingRecords;
	}

	it('names each pass by its kind and place, after the copies and before the gaps', () => {
		const parts = gpuPassStats(
			gpuRecords([
				{ copies: 0.25, passes: [0.5, 1], render: [false, true], frameMs: 2 },
				{ copies: 0.75, passes: [1.5, 2], render: [false, true], frameMs: 5 },
			]),
		);
		expect(parts?.map((part) => part.name)).toEqual([
			'copies',
			'compute 1',
			'render 1',
			'between passes',
		]);
		expect(parts?.[1]?.ms).toMatchObject({ count: 2, median: 1 });
		expect(parts?.[2]?.ms).toMatchObject({ count: 2, median: 1.5 });
		// Frame 1 leaves 2 - 0.25 - 0.5 - 1 = 0.25 ms between passes, frame 2 leaves 0.75 ms.
		expect(parts?.[3]?.ms.median).toBeCloseTo(0.5, 9);
	});

	it('counts passes of each kind apart, and reports no gap for a frame of one pass', () => {
		const three = gpuPassStats(
			gpuRecords([{ copies: 0, passes: [1, 1, 1], render: [true, false, true], frameMs: 3 }]),
		);
		expect(three?.map((part) => part.name)).toEqual([
			'copies',
			'render 1',
			'compute 1',
			'render 2',
			'between passes',
		]);
		const one = gpuPassStats(gpuRecords([{ copies: 0, passes: [1], render: [true], frameMs: 1 }]));
		expect(one?.map((part) => part.name)).toEqual(['copies', 'render 1']);
	});

	it('leaves out the copies where the browser gave no time for them', () => {
		const parts = gpuPassStats(
			gpuRecords([{ copies: UNTIMED, passes: [0.5, 1], render: [false, true], frameMs: 2 }]),
		);
		expect(parts?.map((part) => part.name)).toEqual(['compute 1', 'render 1', 'between passes']);
		expect(parts?.[2]?.ms.median).toBeCloseTo(0.5, 9);
	});

	it('names only the passes timed alone, and gives null without GPU records', () => {
		const many = Array.from({ length: GPU_TIMED_PASSES + 2 }, () => 1);
		const parts = gpuPassStats(
			gpuRecords([{ copies: 0, passes: many, render: many.map(() => true), frameMs: 20 }]),
		);
		expect(parts?.map((part) => part.name)).toEqual([
			'copies',
			...many.slice(0, GPU_TIMED_PASSES).map((_, pass) => `render ${pass + 1}`),
			'between passes',
		]);
		expect(gpuPassStats(gpuRecords([]))).toBeNull();
	});
});

describe('ratePerSecond', () => {
	it('turns intervals into a rate, and gives null without them', () => {
		expect(ratePerSecond([16, 17, 17])).toBeCloseTo(60, 6);
		expect(ratePerSecond([])).toBeNull();
	});
});

describe('timerStep', () => {
	it('finds the rounding step of GPU times, and none for exact times', () => {
		const step = 0.065536;
		expect(timerStep([0, step, 2 * step, step])).toBeCloseTo(step, 9);
		expect(timerStep([0.1234, 0.2468, 0.3719])).toBeNull();
		expect(timerStep([0.001, 0.002])).toBeNull();
		expect(timerStep([0, 0])).toBeNull();
		expect(timerStep([])).toBeNull();
	});
});
