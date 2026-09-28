import { describe, expect, it } from 'bun:test';
import { ratePerSecond, summarizeFrames, threadRoles, timerStep } from '../page/frame-stats';
import { Counter, createMetricsBuffer, FrameRecorder, MetricsReader, Phase, Role } from './metrics';

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
		const game = new FrameRecorder(buffer, Role.Game);
		record(game, 1, 1);
		const reader = new MetricsReader(buffer);
		reader.begin();
		record(game, 2, 2);
		reader.end();
		expect(reader.records[Role.Game]?.frames).toEqual([2]);
	});

	it('count records the writer overwrote before the reader drained them', () => {
		const buffer = createMetricsBuffer(true, 0, 4);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const game = new FrameRecorder(buffer, Role.Game);
		for (let frame = 1; frame <= 10; frame++) record(game, frame, frame);
		reader.drain();
		expect(reader.records[Role.Game]?.frames).toEqual([7, 8, 9, 10]);
		expect(reader.lost).toBe(6);
	});

	it('drop a record that is being rewritten while the reader reads it', () => {
		const buffer = createMetricsBuffer(true, 0, 4);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const game = new FrameRecorder(buffer, Role.Game);
		for (let frame = 1; frame <= 4; frame++) record(game, frame, frame);
		// The writer starts the fifth record in the slot of the first and has not finished it.
		game.begin(5);
		reader.drain();
		expect(reader.records[Role.Game]?.frames).toEqual([2, 3, 4]);
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
	it('places the game and render roles on the threads of each mode', () => {
		const roles = (latency: string, renderThread: string, jobWorkers = 0) =>
			Object.fromEntries(threadRoles({ latency, renderThread, jobWorkers }));
		expect(roles('pipelined', 'render-worker', 2)).toEqual({
			'game-worker': [Role.Game],
			'render-worker': [Role.Render],
			'job-0': [Role.Job],
			'job-1': [Role.Job + 1],
		});
		expect(roles('pipelined', 'main')).toEqual({ 'game-worker': [Role.Game], main: [Role.Render] });
		expect(roles('low', 'game-worker')).toEqual({ 'game-worker': [Role.Game, Role.Render] });
		expect(roles('single', 'main')).toEqual({ main: [Role.Game, Role.Render] });
	});
});

describe('summarizeFrames', () => {
	function run(latency: string, renderThread: string) {
		const buffer = createMetricsBuffer(true, 1);
		const reader = new MetricsReader(buffer);
		reader.begin();
		const game = new FrameRecorder(buffer, Role.Game);
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
			record(game, frame, busy, busy);
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
		// Per frame: game 1, 2, 3; render 2, 2, 2; job 0.5 each.
		expect(summary.cpuMs.median).toBe(2);
		expect(summary.cpuMs.p99).toBeCloseTo(2.98, 9);
		expect(summary.cpuMsAllThreads.median).toBe(4.5);
		expect(Object.keys(summary.threads).sort()).toEqual(['game-worker', 'job-0', 'render-worker']);
		expect(summary.threads['game-worker']?.phases.update?.median).toBe(2);
		expect(summary.intervalMs).toMatchObject({ count: 2, median: 16 });
		expect(summary.drawCalls.median).toBe(10);
		expect(summary.gpuMs?.count).toBe(3);
		expect(summary.gpuStepMs).toBeCloseTo(0.1, 6);
		expect(summary.presentedFps).toBeCloseTo(62.5, 6);
		expect(summary.completedFps).toBeCloseTo(31.25, 6);
		expect(summary.gpuLatencyMs).toMatchObject({ count: 3, median: 4 });
	});

	it('adds up roles that share a thread', () => {
		const summary = run('low', 'game-worker');
		// The game worker also draws: 1 + 2, 2 + 2, 3 + 2.
		expect(summary.cpuMs.median).toBe(4);
		expect(summary.threads['game-worker']?.busyMs.median).toBe(4);
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
