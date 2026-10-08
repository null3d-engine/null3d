import { describe, expect, it } from 'bun:test';
import {
	Counter,
	createMetricsBuffer,
	FrameRecorder,
	MemoryFigure,
	Phase,
	Role,
} from '../shared/metrics';
import { rateLevel, targetFps, workLevel } from './frame-target';
import { overlayFigures, type PageFigures } from './overlay';
import { codeMs, drawingMs, tenthsOfMib, WorkThreads, widthStep } from './overlay-look';
import { type FrameStats, FrameStatsWindow, STATS_WINDOW_MS } from './stats';
import { statsText } from './stats-text';

/** The threads of a pipelined engine with two job workers, as `engine.measure` names them. */
const THREADS: [string, number[]][] = [
	['sketch-worker', [Role.Sketch]],
	['render-worker', [Role.Render]],
	['job-0', [Role.Job]],
	['job-1', [Role.Job + 1]],
];

/** Presented time per frame: the window ends with its 30th frame. */
const PRESENTED_MS = STATS_WINDOW_MS / 30 + 0.001;

/**
 * Writes one frame's records to every ring, with fractions as real frames have. Without `counted`,
 * the frame does not know its triangles and objects.
 */
function writeFrame(recorders: FrameRecorder[], frame: number, scale = 1, counted = true): void {
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
	render.count(Counter.Triangles, counted ? 1536 : 0);
	render.count(Counter.DrawnObjects, counted ? 40 : 0);
	render.count(Counter.UncountedFigures, counted ? 0 : 1);
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

/** A WebAssembly memory of 64 MiB, as the figures read it. */
const WASM_BYTES = 64 * 1024 * 1024;

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
		wasmBytes: () => WASM_BYTES,
	});
	return {
		buffer,
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
		expect(stats.triangles).toBe(1536);
		expect(stats.objects).toBe(40);
		expect(stats.uploadBytes).toBe(3072);
		expect(stats.wasmBytes).toBe(WASM_BYTES);
		// No GPU timer wrote a record, so the GPU time is unknown.
		expect(stats.gpuMs).toBeNull();
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
			wasmBytes: () => WASM_BYTES,
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
			wasmBytes: () => WASM_BYTES,
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

/** The page's own figures where the browser gives none. */
const NO_PAGE_FIGURES: PageFigures = { jsHeapBytes: null, page: null };

describe('statsText', () => {
	it('waits for the first window', () => {
		const { window } = setUp();
		expect(statsText(overlayFigures(window.stats, NO_PAGE_FIGURES))).toBe(
			'webgl2  high  scale 0.75\nwaiting for frames',
		);
	});

	it("shows each thread's time and phases, the job workers in one line, and n/a for figures it lacks", () => {
		const { recorders, window } = setUp();
		for (let frame = 1; frame <= 30; frame++) writeFrame(recorders, frame);
		window.update();
		expect(statsText(overlayFigures(window.stats, NO_PAGE_FIGURES)).split('\n')).toEqual([
			'webgl2  high  scale 0.75',
			'60.0 fps presented, 50.0 completed',
			'busiest thread 2.25 ms per frame',
			'sketch-worker  2.25 ms',
			'  update 0.50  record 1.25',
			'render-worker  1.00 ms',
			'  replay 0.75',
			'job workers (2)  busiest 0.50 ms',
			'gpu n/a',
			'draw calls 12  upload 3.0 KB',
			'triangles 1536  objects 40',
			'memory  wasm 64.0 MiB  js heap n/a',
			'gpu memory  textures 0.0 MiB  meshes 0.0 MiB',
			'page memory n/a',
			'main thread n/a',
		]);
	});

	it('shows the GPU time, the memory and the page thread where they are known', () => {
		const { buffer, recorders, window } = setUp();
		const sketch = recorders[0] as FrameRecorder;
		sketch.publishMemory(MemoryFigure.TextureBytes, 8 * 1024 * 1024);
		sketch.publishMemory(MemoryFigure.MeshBytes, 2.5 * 1024 * 1024);
		const gpu = new FrameRecorder(buffer, Role.Gpu);
		for (let frame = 1; frame <= 30; frame++) {
			writeFrame(recorders, frame);
			if (frame % 10 !== 0) continue;
			gpu.begin(frame);
			gpu.commit(frame === 10 ? 1.5 : 2.5);
		}
		window.update();
		const text = statsText({
			...overlayFigures(window.stats, {
				jsHeapBytes: 12 * 1024 * 1024,
				page: { bytes: 300 * 1024 * 1024, browserBytes: 492 * 1024 * 1024 },
			}),
			mainThread: { seconds: 5, longTasks: 2, longestTaskMs: 120.4, inputDelayMs: 8.2 },
		}).split('\n');
		expect(text.slice(8)).toEqual([
			'gpu 2.17 ms per frame',
			'draw calls 12  upload 3.0 KB',
			'triangles 1536  objects 40',
			'memory  wasm 64.0 MiB  js heap 12.0 MiB',
			'gpu memory  textures 8.0 MiB  meshes 2.5 MiB',
			'page memory 300.0 MiB (browser 492.0 MiB)',
			'main thread 5 s  long tasks 2 (120 ms)  input delay 8 ms',
		]);
	});

	it('shows large counts in thousands and millions, and a page figure still being measured', () => {
		const lines = statsText({
			heading: 'three.js WebGLRenderer',
			frames: 30,
			presentedFps: 60,
			completedFps: null,
			cpuMs: 4,
			threads: [{ name: 'main', busyMs: 4 }],
			gpuMs: 3.25,
			drawCalls: 120,
			uploadBytes: null,
			triangles: 2_345_678,
			objects: 15_000_000,
			memory: {
				wasmBytes: null,
				textureBytes: null,
				meshBytes: null,
				jsHeapBytes: null,
				page: { bytes: null, browserBytes: null },
			},
			mainThread: { seconds: 5, longTasks: 0, longestTaskMs: 0, inputDelayMs: null },
		}).split('\n');
		expect(lines).toEqual([
			'three.js WebGLRenderer',
			'60.0 fps presented',
			'busiest thread 4.00 ms per frame',
			'main  4.00 ms',
			'gpu 3.25 ms per frame',
			'draw calls 120',
			'triangles 2345.7 k  objects 15.00 M',
			'memory  wasm n/a  js heap n/a',
			'gpu memory  textures n/a  meshes n/a',
			'page memory measuring',
			'main thread 5 s  long tasks 0  input delay n/a',
		]);
	});
});

describe('FrameStatsWindow counts', () => {
	it('leaves out of the triangles and objects the frames that do not know them', () => {
		const { recorders, window } = setUp();
		// The first frames sample before the GPU-culled draws' counts come back.
		for (let frame = 1; frame <= 30; frame++) writeFrame(recorders, frame, 1, frame > 5);
		window.update();
		expect(window.stats.triangles).toBe(1536);
		expect(window.stats.objects).toBe(40);
		expect(window.stats.drawCalls).toBe(12);
	});
});

describe('FrameStatsWindow GPU time', () => {
	it('keeps the GPU time of the last window that held a timed frame', () => {
		const { buffer, recorders, window } = setUp();
		const gpu = new FrameRecorder(buffer, Role.Gpu);
		for (let frame = 1; frame <= 30; frame++) writeFrame(recorders, frame);
		gpu.begin(11);
		gpu.commit(4);
		window.update();
		expect(window.stats.gpuMs).toBe(4);
		for (let frame = 31; frame <= 60; frame++) writeFrame(recorders, frame);
		window.update();
		expect(window.stats.gpuMs).toBe(4);
		expect(JSON.parse(JSON.stringify(window.stats)).gpuMs).toBe(4);
	});
});

describe('the overlay target and colors', () => {
	it("aims at the display's rate, at most 60 frames a second, or a lower cap", () => {
		expect(targetFps(0, undefined)).toBe(60);
		expect(targetFps(120, undefined)).toBe(60);
		expect(targetFps(50, undefined)).toBe(50);
		expect(targetFps(120, 30)).toBe(30);
		expect(targetFps(120, 90)).toBe(60);
	});

	it('colors work green below 80% of the interval, amber up to it, and red past it', () => {
		expect([10, 13.2, 13.4, 16.6, 16.7, 17].map((ms) => workLevel(ms, 16.6))).toEqual([
			'ok',
			'ok',
			'warn',
			'warn',
			'bad',
			'bad',
		]);
	});

	it('colors the frame rate green from 90% of the target, amber from 75%, and red below', () => {
		expect([60, 54, 53.9, 45, 44.9].map((fps) => rateLevel(fps, 60))).toEqual([
			'ok',
			'ok',
			'warn',
			'warn',
			'bad',
		]);
	});

	it('steps a bar from empty to full, and adds memory up in tenths of a MiB', () => {
		expect([-1, 0, 0.002, 0.256, 1, 2.5].map(widthStep)).toEqual([0, 0, 0, 51, 200, 200]);
		expect(tenthsOfMib(64 * 1024 * 1024)).toBe(640);
		expect(tenthsOfMib(1.26 * 1024 * 1024)).toBe(13);
	});

	it("splits a thread's time into the sketch's code and the engine's work", () => {
		expect(codeMs({ name: 'sketch-worker', busyMs: 2, phases: { update: 0.5, record: 1 } })).toBe(
			0.5,
		);
		expect(codeMs({ name: 'render-worker', busyMs: 1, phases: { replay: 0.8 } })).toBe(0);
		expect(codeMs({ name: 'main', busyMs: 0.4, phases: { update: 0.5 } })).toBe(0.4);
	});

	it('finds each thread of the work bars, with the job workers as their slowest', () => {
		const threads = new WorkThreads();
		threads.update([
			{ name: 'sketch-worker', busyMs: 2 },
			{ name: 'render-worker', busyMs: 1 },
			{ name: 'job-0', busyMs: 0.5 },
			{ name: 'job-1', busyMs: 0.9 },
			{ name: 'job-2', busyMs: 0.7 },
		]);
		expect(threads.sketch?.busyMs).toBe(2);
		expect(threads.drawing?.busyMs).toBe(1);
		expect(threads.page).toBeUndefined();
		expect(threads.jobs).toBe(3);
		expect(threads.slowestJob?.name).toBe('job-1');
		threads.update([{ name: 'main', busyMs: 3 }]);
		expect([threads.sketch, threads.drawing, threads.slowestJob, threads.jobs]).toEqual([
			undefined,
			undefined,
			undefined,
			0,
		]);
		expect(threads.page?.busyMs).toBe(3);
	});

	it('puts the thread that runs the sketch and draws on one bar, with the drawing last', () => {
		const threads = new WorkThreads();
		const both = {
			name: 'sketch-worker',
			busyMs: 6,
			phases: { update: 1, upload: 0.5, replay: 2 },
		};
		threads.update([both, { name: 'job-0', busyMs: 1 }], 'sketch-worker');
		expect(threads.both).toBe(both);
		expect(threads.sketch).toBeUndefined();
		expect(drawingMs(both)).toBe(2.5);
		expect(
			drawingMs({ name: 'main', busyMs: 1, phases: { update: 0.8, replay: 0.5 } }),
		).toBeCloseTo(0.2);
	});

	it('names the bar furthest past the target, or the work outside the engine', () => {
		const threads = new WorkThreads();
		threads.update([
			{ name: 'sketch-worker', busyMs: 18 },
			{ name: 'render-worker', busyMs: 12 },
			{ name: 'job-0', busyMs: 20 },
		]);
		expect(threads.heldBackBy(16.7, 19)).toBe('Jobs');
		expect(threads.heldBackBy(16.7, 25)).toBe('GPU');
		expect(threads.heldBackBy(25, 24)).toBe('outside the engine');
		threads.update([{ name: 'main', busyMs: 30 }], 'main');
		expect(threads.heldBackBy(16.7, null)).toBe('Sketch + drawing');
	});
});
