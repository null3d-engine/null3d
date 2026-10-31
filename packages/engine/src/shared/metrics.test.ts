import { describe, expect, it } from 'bun:test';
import { CORE_NOT_COUNTED } from '../generated/core';
import { PASS_ROLE_NAMES } from '../generated/gpu';
import { gpuPassStats, secondRates, summarizeFrames, timerStep } from '../page/frame-stats';
import { QUALITY_SETTINGS } from '../quality/presets';
import {
	Counter,
	createMetricsBuffer,
	FrameRecorder,
	GPU_TIMED_PASSES,
	MetricsReader,
	Phase,
	type RingRecords,
	RingSums,
	Role,
	SAMPLED_EVERY,
	SUM_BUSY_MS,
	SUM_COUNTERS,
	SUM_INTERVAL_MS,
	SUM_LONGEST_BUSY_MS,
	SUM_PHASES,
	SUM_RECORDS,
	sampleFrames,
	threadRoles,
	UNTIMED,
} from './metrics';
import { ratePerSecond } from './stats';

function record(recorder: FrameRecorder, frame: number, busy: number, update = 0): void {
	recorder.begin(frame);
	if (update > 0) recorder.addPhase(Phase.Update, update);
	recorder.commit(busy);
}

describe('frame records', () => {
	it('keep costly timing on until the last of two overlapping measurements ends', () => {
		const buffer = createMetricsBuffer(true, 0);
		const recorder = new FrameRecorder(buffer, Role.Render);
		const first = new MetricsReader(buffer);
		const second = new MetricsReader(buffer);
		first.begin();
		second.begin();
		first.end();
		expect(recorder.measuring).toBe(true);
		second.end();
		expect(recorder.measuring).toBe(false);
	});

	it('read the figures that only the overlay shows only while a reader of the figures samples', () => {
		const buffer = createMetricsBuffer(true, 0);
		const recorder = new FrameRecorder(buffer, Role.Render);
		const measurement = new MetricsReader(buffer);
		measurement.begin();
		expect(recorder.measuring).toBe(true);
		expect(recorder.figures).toBe(false);
		sampleFrames(buffer, true);
		expect(recorder.figures).toBe(true);
		measurement.end();
		expect(recorder.measuring).toBe(true);
		sampleFrames(buffer, false);
		expect(recorder.measuring).toBe(false);
		expect(recorder.figures).toBe(false);
	});

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

	it('reach the page after a hold, which steps every frame before the page reads any', () => {
		const buffer = createMetricsBuffer(true, 0, 4);
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		const render = new FrameRecorder(buffer, Role.Render);
		for (let frame = 1; frame <= 6; frame++) record(sketch, frame, frame);
		record(render, 6, 2);
		const reader = new MetricsReader(buffer);
		const records = reader.readWritten();
		expect(records[Role.Sketch]?.frames).toEqual([3, 4, 5, 6]);
		expect(records[Role.Render]?.frames).toEqual([6]);
		expect(reader.lost).toBe(2);
		expect(render.measuring).toBe(false);
		const threads = threadRoles({
			latency: 'pipelined',
			renderThread: 'render-worker',
			jobWorkers: 0,
		});
		const held = summarizeFrames(records, threads);
		expect([held.frames, held.cpuMs.median, held.threads['render-worker']?.busyMs.median]).toEqual([
			1, 6, 2,
		]);
	});

	it('keep the time and the draw time of the first frame only', () => {
		const buffer = createMetricsBuffer(true, 0);
		const render = new FrameRecorder(buffer, Role.Render);
		const reader = new MetricsReader(buffer);
		expect(reader.firstFrameTime).toBe(0);
		expect(reader.firstDrawMs).toBeNull();
		render.markFirstFrame(12.5);
		const first = reader.firstFrameTime;
		render.markFirstFrame(3);
		expect(first).toBeGreaterThan(0);
		expect(reader.firstFrameTime).toBe(first);
		expect(reader.firstDrawMs).toBe(12.5);
	});

	it('keep the start and the length of the sketch setup, and the first builds, once', () => {
		const buffer = createMetricsBuffer(true, 0);
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		const reader = new MetricsReader(buffer);
		expect([reader.setupStart, reader.setupMs, reader.warmUpStart]).toEqual([0, null, 0]);
		sketch.markSetupStart();
		const started = reader.setupStart;
		expect(started).toBeGreaterThan(0);
		expect(reader.setupMs).toBeNull();
		sketch.markSetupStart();
		sketch.markSetupDone(1200);
		sketch.markSetupDone(5);
		expect(reader.setupStart).toBe(started);
		expect(reader.setupMs).toBe(1200);
		sketch.markWarmUp(true);
		const warmUp = reader.warmUpStart;
		sketch.markWarmUp(false);
		expect(warmUp).toBeGreaterThan(0);
		expect(reader.warmUpStart).toBe(warmUp);
		expect(reader.warmUpMs).not.toBeNull();
	});

	it('tell a setup that took no measurable time from one still running', () => {
		const buffer = createMetricsBuffer(false, 0);
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		const reader = new MetricsReader(buffer);
		sketch.markSetupStart();
		sketch.markSetupDone(0);
		expect(reader.setupMs).toBeGreaterThan(0);
		expect(Math.round(reader.setupMs as number)).toBe(0);
	});

	it('sum the records of a window without turning costly timing on', () => {
		const buffer = createMetricsBuffer(true, 0, 4);
		const completion = new FrameRecorder(buffer, Role.Completion);
		record(completion, 1, 3);
		const sums = new RingSums(buffer, Role.Completion);
		for (let frame = 2; frame <= 3; frame++) {
			completion.begin(frame);
			completion.interval(frame * 10);
			completion.commit(frame);
		}
		sums.add();
		// The record written before the sums started stays out.
		expect([...sums.sums]).toEqual([2, 5, 3, 50]);
		expect(completion.measuring).toBe(false);
		sums.clear();
		sums.add();
		expect(sums.sums[SUM_RECORDS]).toBe(0);
		// Of the six records written before the next read, the ring still holds the last four.
		for (let frame = 4; frame <= 9; frame++) record(completion, frame, 1);
		sums.add();
		expect(sums.sums[SUM_RECORDS]).toBe(4);
		expect(sums.sums[SUM_BUSY_MS]).toBe(4);
		expect(sums.sums[SUM_LONGEST_BUSY_MS]).toBe(1);
		expect(sums.sums[SUM_INTERVAL_MS]).toBe(0);
	});

	it('sum each phase and counter of a window with detail', () => {
		const buffer = createMetricsBuffer(false, 0);
		const render = new FrameRecorder(buffer, Role.Render);
		const plain = new RingSums(buffer, Role.Render);
		const detailed = new RingSums(buffer, Role.Render, true);
		for (let frame = 1; frame <= 2; frame++) {
			render.begin(frame);
			render.addPhase(Phase.Replay, frame * 0.5);
			render.count(Counter.DrawCalls, frame * 10);
			render.interval(16);
			render.commit(1);
		}
		plain.add();
		detailed.add();
		expect(plain.sums).toHaveLength(SUM_PHASES);
		expect(detailed.sums[SUM_RECORDS]).toBe(2);
		expect(detailed.sums[SUM_PHASES + Phase.Replay]).toBe(1.5);
		expect(detailed.sums[SUM_PHASES + Phase.Update]).toBe(0);
		expect(detailed.sums[SUM_COUNTERS + Counter.DrawCalls]).toBe(30);
		detailed.clear();
		expect(detailed.sums.every((sum) => sum === 0)).toBe(true);
	});

	it('refuse a ring the buffer does not have', () => {
		expect(() => new FrameRecorder(createMetricsBuffer(true, 1), Role.Job + 1)).toThrow('no ring');
	});
});

describe('threadRoles', () => {
	it('places the sketch and render roles on the threads of each mode', () => {
		const roles = (latency: string, renderThread: string, jobWorkers = 0, sketchThread?: string) =>
			Object.fromEntries(threadRoles({ latency, renderThread, jobWorkers, sketchThread }));
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

	it('places the sketch on the page when the mode runs it there', () => {
		const roles = (latency: string, renderThread: string) =>
			Object.fromEntries(
				threadRoles({ latency, renderThread, jobWorkers: 1, sketchThread: 'main' }),
			);
		expect(roles('pipelined', 'render-worker')).toEqual({
			main: [Role.Sketch],
			'render-worker': [Role.Render],
			'job-0': [Role.Job],
		});
		expect(roles('low', 'main')).toEqual({ main: [Role.Sketch, Role.Render], 'job-0': [Role.Job] });
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
			// The first frame built two pipelines, and the second skipped three draws of a third.
			render.count(Counter.Pipelines, frame === 1 ? 2 : 0);
			render.count(Counter.SkippedDraws, frame === 2 ? 3 : 0);
			render.commit(2);
			// The browser rounds the frame's timestamps to a step of 0.1 ms, which is the greatest
			// common divisor of the offsets that the record carries.
			gpu.begin(frame);
			gpu.gpuTick(100_000 * frame);
			gpu.commit(0.1 * frame);
			// The GPU finishes each frame 4 ms after its submit, 32 ms apart: half the presented rate.
			// Every completion record has an interval, since the first completion leaves none.
			completion.begin(frame);
			completion.interval(32);
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
		expect([summary.pipelines, summary.skippedDraws]).toEqual([2, 3]);
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
		frames: {
			copies: number;
			passes: number[];
			render: boolean[];
			frameMs: number;
			/** Each pass's label, in the order of the frame's passes. */
			roles?: number[];
		}[],
	) {
		const buffer = createMetricsBuffer(false, 0);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const gpu = new FrameRecorder(buffer, Role.Gpu);
		frames.forEach(({ copies, passes, render, frameMs, roles }, index) => {
			gpu.begin(index + 1);
			let renderPasses = 0;
			render.forEach((isRender, pass) => {
				if (isRender) renderPasses |= 1 << pass;
			});
			gpu.gpuPasses(passes.length, renderPasses);
			gpu.gpuTime(0, copies);
			passes.slice(0, GPU_TIMED_PASSES).forEach((ms, pass) => {
				gpu.gpuTime(1 + pass, ms);
				gpu.gpuPassRole(pass, roles?.[pass] ?? 0);
			});
			gpu.commit(frameMs);
		});
		reader.end();
		return reader.records[Role.Gpu] as RingRecords;
	}

	/** A pass label from the role's name and its place among the passes of that role. */
	function label(name: string, place = 0): number {
		const role = PASS_ROLE_NAMES.indexOf(name);
		if (role < 0) throw new Error(`no pass role ${name}`);
		return (role | (place << 16)) >>> 0;
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

	it('names each pass by what it draws for rather than its slot', () => {
		const parts = gpuPassStats(
			gpuRecords([
				{
					copies: 0.1,
					passes: [0.4, 0.6, 0.2],
					render: [false, true, true],
					roles: [label('compute'), label('shadow cascade', 1), label('shadow hero')],
					frameMs: 1.3,
				},
			]),
		);
		expect(parts?.map((part) => part.name)).toEqual([
			'copies',
			'compute',
			'shadow cascade 1',
			'shadow hero',
			'between passes',
		]);
	});

	it('adds a role together across frames even where the pass moves slot', () => {
		// The far cascade draws in the first frame only, so the hero's pass lands one slot earlier
		// there. Both frames' cascade times belong to the cascade, not to a position.
		const parts = gpuPassStats(
			gpuRecords([
				{
					copies: 0,
					passes: [0.5, 0.7],
					render: [true, true],
					roles: [label('shadow cascade', 0), label('shadow hero')],
					frameMs: 1.2,
				},
				{
					copies: 0,
					passes: [0.3, 0.9],
					render: [true, true],
					roles: [label('shadow cascade', 0), label('final')],
					frameMs: 1.2,
				},
			]),
		);
		expect(parts?.map((part) => part.name)).toEqual([
			'copies',
			'shadow cascade 0',
			'shadow hero',
			'between passes',
			'final',
		]);
		expect(parts?.[1]?.ms).toMatchObject({ count: 2 });
		expect(parts?.[1]?.ms.median).toBeCloseTo(0.4, 6);
	});

	it('prints a place only where the role has one', () => {
		const parts = gpuPassStats(
			gpuRecords([
				{
					copies: 0,
					passes: [0.2, 0.3],
					render: [true, true],
					roles: [label('opaque'), label('opaque', 2)],
					frameMs: 0.5,
				},
			]),
		);
		expect(parts?.map((part) => part.name)).toEqual([
			'copies',
			'opaque',
			'opaque 2',
			'between passes',
		]);
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

	it('leaves out a pass that the GPU left untimed, and the time between passes of its frame', () => {
		const parts = gpuPassStats(
			gpuRecords([
				{ copies: 0, passes: [0.5, UNTIMED], render: [false, true], frameMs: 2 },
				{ copies: 0, passes: [0.5, 1], render: [false, true], frameMs: 2 },
			]),
		);
		expect(parts?.map((part) => part.name)).toEqual([
			'copies',
			'compute 1',
			'render 1',
			'between passes',
		]);
		expect(parts?.[2]?.ms).toMatchObject({ count: 1, median: 1 });
		expect(parts?.[3]?.ms).toMatchObject({ count: 1 });
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

describe('secondRates', () => {
	/** Records presented frames and completions `intervals` apart, each list in its own ring. */
	function rates(presented: readonly number[], completed: readonly number[]) {
		const buffer = createMetricsBuffer(true, 1);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const render = new FrameRecorder(buffer, Role.Render);
		const completion = new FrameRecorder(buffer, Role.Completion);
		presented.forEach((ms, frame) => {
			render.begin(frame);
			render.interval(ms);
			render.commit(1);
		});
		completed.forEach((ms, frame) => {
			completion.begin(frame);
			completion.interval(ms);
			completion.commit(1);
		});
		reader.end();
		return secondRates(reader.records);
	}

	it('counts the frames of each whole second, and leaves out the second that has not ended', () => {
		// 50 frames a second for 2 s, then 25 a second: frames at 10, 30 ... 1990, then 2030 ... 4030.
		const presented = [10, ...new Array(99).fill(20), ...new Array(51).fill(40)];
		// The GPU finishes the first second's frames in pairs: an interval of 0 joins the one before.
		const pairs = new Array(50).fill(0).map((_, i) => (i === 0 ? 20 : i % 2 === 0 ? 40 : 0));
		const seconds = rates(presented, [...pairs, ...new Array(151).fill(20)]);
		expect(seconds.map((s) => s.presentedFps)).toEqual([50, 50, 25, 25]);
		expect(seconds.map((s) => s.completedFps)).toEqual([50, 50, 50, 50]);
	});

	it('stops where the completions stop, and gives null rates without any', () => {
		const presented = [10, ...new Array(199).fill(20)];
		expect(rates(presented, [10, ...new Array(74).fill(20)])).toEqual([
			{ presentedFps: 50, completedFps: 50 },
		]);
		expect(rates(presented, [])).toEqual(
			new Array(3).fill({ presentedFps: 50, completedFps: null }),
		);
		expect(rates([], [])).toEqual([]);
	});
});

describe('ratePerSecond', () => {
	it('turns intervals into a rate, and gives null without them', () => {
		expect(ratePerSecond([16, 17, 17])).toBeCloseTo(60, 6);
		expect(ratePerSecond([])).toBeNull();
	});
});

describe('timerStep', () => {
	it('finds the step as the divisor of the offsets, and none when the times look exact', () => {
		// Every offset is a whole number of the browser's 65.536 us rounding steps.
		expect(timerStep([65536, 131072, 196608])).toBeCloseTo(0.065536, 9);
		// The frames' own steps may share a factor, and their divisor is still the browser's step.
		expect(timerStep([200_000, 300_000])).toBeCloseTo(0.1, 9);
		expect(timerStep([1, 2, 3])).toBeNull();
		expect(timerStep([0, 0])).toBeNull();
		expect(timerStep([])).toBeNull();
		expect(timerStep(undefined)).toBeNull();
	});
});

describe('SAMPLED_EVERY', () => {
	it('times frames in every phase of each far cascade interval', () => {
		const { min, max } = QUALITY_SETTINGS.farCascadeInterval.values;
		for (let interval = min; interval <= max; interval++) {
			const phases = new Set<number>();
			for (let k = 0; k < interval; k++) phases.add((k * SAMPLED_EVERY) % interval);
			expect([interval, phases.size]).toEqual([interval, interval]);
		}
	});
});
