import { describe, expect, it } from 'bun:test';
import { Counter, createMetricsBuffer, FrameRecorder, Phase, Role } from '../shared/metrics';
import { statsText } from './overlay';
import { type FrameStats, FrameStatsWindow, STATS_WINDOW_MS } from './stats';

/** The threads of a pipelined engine with two job workers, as `engine.measure` names them. */
const THREADS: [string, number[]][] = [
	['sketch-worker', [Role.Sketch]],
	['render-worker', [Role.Render]],
	['job-0', [Role.Job]],
	['job-1', [Role.Job + 1]],
];

/** Presented time per frame: the window ends with its 30th frame. */
const PRESENTED_MS = STATS_WINDOW_MS / 30 + 0.001;

/** Writes one frame's records to every ring, with fractions as real frames have. */
function writeFrame(recorders: FrameRecorder[], frame: number, scale = 1): void {
	const [sketch, render, completion, job0, job1] = recorders as [
		FrameRecorder,
		FrameRecorder,
		FrameRecorder,
		FrameRecorder,
		FrameRecorder,
	];
	sketch.begin(frame);
	sketch.addPhase(Phase.Update, 0.5 * scale);
	sketch.addPhase(Phase.Record, 1.25 * scale);
	sketch.commit(2.25 * scale);
	render.begin(frame);
	render.addPhase(Phase.Replay, 0.75);
	render.count(Counter.DrawCalls, 12);
	render.count(Counter.UploadBytes, 3072);
	render.interval(PRESENTED_MS);
	render.commit(1);
	completion.begin(frame);
	completion.interval(20);
	completion.commit(30);
	job0.begin(frame);
	job0.addPhase(Phase.Cull, 0.25);
	job0.commit(0.25);
	job1.begin(frame);
	job1.commit(0.5);
}

function setUp() {
	const buffer = createMetricsBuffer(false, 2);
	const recorders = [Role.Sketch, Role.Render, Role.Completion, Role.Job, Role.Job + 1].map(
		(role) => new FrameRecorder(buffer, role),
	);
	let preset: 'low' | 'high' = 'high';
	let scale = 750;
	const window = new FrameStatsWindow(buffer, THREADS, {
		tier: 'webgl2',
		preset: () => preset,
		renderScaleThousandths: () => scale,
	});
	return {
		recorders,
		window,
		setPreset: (value: typeof preset) => {
			preset = value;
		},
		setScale: (value: number) => {
			scale = value;
		},
	};
}

describe('FrameStatsWindow', () => {
	it('publishes means per frame once the presented frames cover a window', () => {
		const { recorders, window } = setUp();
		for (let frame = 1; frame < 30; frame++) writeFrame(recorders, frame);
		expect(window.update()).toBe(false);
		expect(window.stats.frames).toBe(0);
		writeFrame(recorders, 30);
		expect(window.update()).toBe(true);
		const { stats } = window;
		expect(stats.frames).toBe(30);
		expect(stats.seconds).toBeCloseTo(0.5, 3);
		expect(stats.presentedFps).toBeCloseTo(60, 1);
		expect(stats.completedFps).toBeCloseTo(50, 6);
		expect(stats.cpuMs).toBeCloseTo(2.25, 6);
		expect(stats.drawCalls).toBe(12);
		expect(stats.uploadBytes).toBe(3072);
		expect(stats.tier).toBe('webgl2');
		expect(stats.preset).toBe('high');
		expect(stats.renderScale).toBe(0.75);
		expect(stats.threads.map((thread) => thread.name)).toEqual([
			'sketch-worker',
			'render-worker',
			'job-0',
			'job-1',
		]);
		const [sketch, render, job0, job1] = stats.threads as FrameStatsThreads;
		expect(sketch.busyMs).toBeCloseTo(2.25, 6);
		expect(sketch.phases.update).toBeCloseTo(0.5, 6);
		expect(sketch.phases.record).toBeCloseTo(1.25, 6);
		expect(sketch.phases.replay).toBe(0);
		expect(render.phases.replay).toBeCloseTo(0.75, 6);
		expect(job0.phases.cull).toBeCloseTo(0.25, 6);
		expect(job1.busyMs).toBeCloseTo(0.5, 6);
		// A copy or the JSON of the figures holds every figure, as a log needs.
		const logged = JSON.parse(JSON.stringify(stats));
		expect(logged).toMatchObject({ frames: 30, drawCalls: 12, tier: 'webgl2' });
		expect(logged.threads[0]).toMatchObject({
			name: 'sketch-worker',
			busyMs: 2.25,
			phases: { update: 0.5, replay: 0 },
		});
		expect({ ...stats }.uploadBytes).toBe(3072);
	});

	it('leaves out the records written before it started, and starts each window empty', () => {
		const buffer = createMetricsBuffer(false, 2);
		const recorders = [Role.Sketch, Role.Render, Role.Completion, Role.Job, Role.Job + 1].map(
			(role) => new FrameRecorder(buffer, role),
		);
		for (let frame = 1; frame <= 30; frame++) writeFrame(recorders, frame, 10);
		const window = new FrameStatsWindow(buffer, THREADS, {
			tier: 'webgpu',
			preset: () => 'low',
			renderScaleThousandths: () => 1000,
		});
		expect(window.update()).toBe(false);
		for (let frame = 31; frame <= 60; frame++) writeFrame(recorders, frame);
		expect(window.update()).toBe(true);
		expect(window.stats.cpuMs).toBeCloseTo(2.25, 6);
		for (let frame = 61; frame <= 90; frame++) writeFrame(recorders, frame, 2);
		expect(window.update()).toBe(true);
		expect(window.stats.frames).toBe(30);
		expect(window.stats.cpuMs).toBeCloseTo(4.5, 6);
	});

	it('reads the preset and the render scale when a window ends', () => {
		const { recorders, window, setPreset, setScale } = setUp();
		for (let frame = 1; frame <= 30; frame++) writeFrame(recorders, frame);
		window.update();
		setPreset('low');
		setScale(500);
		expect(window.stats.preset).toBe('high');
		for (let frame = 31; frame <= 60; frame++) writeFrame(recorders, frame);
		window.update();
		expect(window.stats.preset).toBe('low');
		expect(window.stats.renderScale).toBe(0.5);
	});

	it('adds the times of every role of a thread that runs several', () => {
		const buffer = createMetricsBuffer(false, 0);
		const sketch = new FrameRecorder(buffer, Role.Sketch);
		const render = new FrameRecorder(buffer, Role.Render);
		const window = new FrameStatsWindow(buffer, [['main', [Role.Sketch, Role.Render]]], {
			tier: 'webgpu',
			preset: () => 'medium',
			renderScaleThousandths: () => 1000,
		});
		for (let frame = 1; frame <= 30; frame++) {
			sketch.begin(frame);
			sketch.addPhase(Phase.Update, 1.5);
			sketch.commit(2.5);
			render.begin(frame);
			render.addPhase(Phase.Replay, 1.25);
			render.interval(PRESENTED_MS);
			render.commit(1.25);
		}
		expect(window.update()).toBe(true);
		const [main] = window.stats.threads as FrameStatsThreads;
		expect(main.busyMs).toBeCloseTo(3.75, 6);
		expect(main.phases.update).toBeCloseTo(1.5, 6);
		expect(main.phases.replay).toBeCloseTo(1.25, 6);
		expect(window.stats.cpuMs).toBeCloseTo(3.75, 6);
		// No completion arrived, so the completed rate is 0.
		expect(window.stats.completedFps).toBe(0);
	});
});

type FrameStatsThreads = [
	FrameStats['threads'][number],
	FrameStats['threads'][number],
	FrameStats['threads'][number],
	FrameStats['threads'][number],
];

describe('statsText', () => {
	it('waits for the first window', () => {
		const { window } = setUp();
		expect(statsText(window.stats)).toBe('webgl2  high  scale 0.75\nwaiting for frames');
	});

	it("shows each thread's time and phases, and the job workers in one line", () => {
		const { recorders, window } = setUp();
		for (let frame = 1; frame <= 30; frame++) writeFrame(recorders, frame);
		window.update();
		expect(statsText(window.stats).split('\n')).toEqual([
			'webgl2  high  scale 0.75',
			'60.0 fps presented, 50.0 completed',
			'busiest thread 2.25 ms per frame',
			'sketch-worker  2.25 ms',
			'  update 0.50  record 1.25',
			'render-worker  1.00 ms',
			'  replay 0.75',
			'job workers (2)  busiest 0.50 ms',
			'draw calls 12  upload 3.0 KB',
		]);
	});
});
