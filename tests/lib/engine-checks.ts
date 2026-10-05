// Checks of the engine test page's result, shared by the Playwright tests and the real-browser runner.

import { SAMPLED_EVERY } from '../../packages/engine/src/shared/metrics.ts';

export interface EngineMode {
	name: string;
	/** URL switches that select the mode. */
	query: string;
	build: 'threaded' | 'single';
	latency: 'pipelined' | 'low' | 'single';
	/** The thread that runs the sketch and the engine core. */
	sketchThread: 'worker' | 'main';
	renderThread: 'render-worker' | 'sketch-worker' | 'main';
	/** The job workers that the switches ask for with `jobs=`; undefined leaves the count to the device. */
	jobWorkers?: number;
}

export const ENGINE_MODES = [
	{
		name: 'pipelined',
		query: '',
		build: 'threaded',
		latency: 'pipelined',
		sketchThread: 'worker',
		renderThread: 'render-worker',
	},
	{
		name: 'low latency',
		query: 'latency=low',
		build: 'threaded',
		latency: 'low',
		sketchThread: 'worker',
		renderThread: 'sketch-worker',
	},
	{
		name: 'single-threaded',
		query: 'threads=off',
		build: 'single',
		latency: 'single',
		sketchThread: 'main',
		renderThread: 'main',
	},
	{
		name: 'drawing on the main thread',
		query: 'render=main',
		build: 'threaded',
		latency: 'pipelined',
		sketchThread: 'worker',
		renderThread: 'main',
	},
	{
		name: 'sketch on the main thread',
		query: 'sketch-thread=main',
		build: 'threaded',
		latency: 'pipelined',
		sketchThread: 'main',
		renderThread: 'render-worker',
	},
] as const satisfies readonly EngineMode[];

/** The thread modes with worker threads, whose threads wait for each other. */
export const THREADED_MODES = ENGINE_MODES.filter(({ build }) => build === 'threaded');

/** The name of a thread mode, as the image test manifest lists it. */
export type EngineModeName = (typeof ENGINE_MODES)[number]['name'];

/** The thread mode the engine reports it runs in. */
export interface ReportedMode {
	build: string;
	latency: string;
	sketchThread: string;
	renderThread: string;
}

/** What differs between the thread mode the engine reports and the mode the switches asked for. */
export function modeProblems(reported: ReportedMode, mode: EngineMode): string[] {
	const problems: string[] = [];
	if (reported.build !== mode.build) problems.push(`loaded the ${reported.build} build`);
	if (reported.latency !== mode.latency) problems.push(`ran ${reported.latency} latency`);
	if (reported.sketchThread !== mode.sketchThread)
		problems.push(`ran the sketch on ${reported.sketchThread}, expected ${mode.sketchThread}`);
	if (reported.renderThread !== mode.renderThread)
		problems.push(`drew on ${reported.renderThread}, expected ${mode.renderThread}`);
	return problems;
}

interface Spread {
	count: number;
	median: number;
}

/** Frames that the sketch computed and the renderer drew, and frames presented, in a measurement. */
export interface FrameCounts {
	frames: number;
	presented: number;
}

export interface EngineResult {
	mode: ReportedMode & { jobWorkers: number };
	capabilities: { tier: string; threaded: boolean; features: string[] };
	report: { crossOriginIsolated: boolean; atomicsWaitAsync: boolean };
	stats: {
		frames: number;
		cpuMs: Spread;
		intervalMs: Spread;
		presentedFps: number;
		threads: Record<string, { busyMs: Spread }>;
		gpuMs: Spread | null;
		visibleEntries: Spread | null;
		load: {
			firstFrameMs: number | null;
			firstFrameDoneMs: number | null;
			probeMs: number;
			coreMs: number;
		};
		memory: { wasmBytes: number | null };
		completedFps: number | null;
		gpuLatencyMs: Spread | null;
		completionSignal: string;
		refreshHz: number | null;
		mainThread: { longTasks: number; longestTaskMs: number } | null;
	};
	count: { updates: number; largestStep: number };
	stages: string[];
	messages: string[];
	/** With `?pause`: the frames drawn while the sketch was paused, and after it resumed. */
	pause?: { paused: FrameCounts; resumed: FrameCounts };
	/** How long the engine took to stop. */
	stopMs: number;
	/** How long the page measured frames for, in seconds. */
	seconds: number;
	/**
	 * With `?memory-option=`: the maximum in MiB of each shared memory that the engine asked the
	 * browser for.
	 */
	sharedMemoryMiB?: number[];
	/** With `?downloads`: each file the page asked for, with when it asked and when the file arrived. */
	downloads?: { name: string; startTime: number; responseEnd: number }[];
	/** The page's steps, each as its time in ms since the page started and its name. */
	trail?: string[];
}

/** Slower than this median frame interval means the loop is not keeping up with the display. */
const MAX_MEDIAN_INTERVAL_MS = 34;
/**
 * The share of the frames that the slowest accepted median interval gives over a measurement, below
 * which the loop stalled. A slow GPU drops the loop to half the display's rate, as on CI's software
 * GPU, and the median check accepts that rate, so the floor sits well under it.
 */
const MIN_FRAME_SHARE = 0.5;
/** A measured refresh rate outside this range is a measuring fault, not a display. */
const REFRESH_HZ_RANGE = [20, 500] as const;
/**
 * A clean stop takes milliseconds. A stop that takes longer ran into the engine's time limit, which
 * means a job worker never left the job system and was stopped inside its wait.
 */
const MAX_STOP_MS = 1_000;

/** The threads that record frames in a mode. */
function expectedThreads(mode: EngineMode): string[] {
	const sketch = mode.sketchThread === 'main' ? 'main' : 'sketch-worker';
	return mode.renderThread === sketch ? [sketch] : [sketch, mode.renderThread];
}

/**
 * Why an engine's job worker count is wrong when a page asked for `asked` with `?jobs=`, or
 * undefined when the page asked for none or the engine started that many.
 */
export function jobWorkersProblem(
	started: number | undefined,
	asked: number | undefined,
): string | undefined {
	if (asked === undefined || started === asked) return undefined;
	return `started ${started ?? 'no'} job workers, not the ${asked} that ?jobs= asked for`;
}

/** Which of the engine page's checks a test runs. */
export interface EngineChecks {
	/**
	 * False leaves out the frame-rate checks: the median frame interval, the floors on the frames
	 * and the sketch's updates, and the need for a measured refresh rate, which takes the thread that
	 * draws a few dozen frames. The engine must still draw frames and update the sketch, at any rate,
	 * and a refresh rate it measured must still be a display's. A test whose job is not the loop's
	 * pace sets it, such as a test of the start's downloads or of a start option: a busy runner can
	 * slow every frame of its short measurement, which says nothing about what that test checks.
	 */
	pacing?: boolean;
}

/** What is wrong with a result of the engine page, run in a mode on a GPU tier; empty when nothing is. */
export function engineProblems(
	result: EngineResult,
	mode: EngineMode,
	tier: string,
	{ pacing = true }: EngineChecks = {},
): string[] {
	const { stats } = result;
	const minFrames = pacing
		? ((result.seconds * 1000) / MAX_MEDIAN_INTERVAL_MS) * MIN_FRAME_SHARE
		: 1;
	const problems = modeProblems(result.mode, mode);
	if (result.mode.jobWorkers >= 1 !== (mode.build === 'threaded'))
		problems.push(`started ${result.mode.jobWorkers} job workers`);
	const jobs = jobWorkersProblem(result.mode.jobWorkers, mode.jobWorkers);
	if (jobs) problems.push(jobs);
	if (!result.capabilities.tier.startsWith(tier)) problems.push(`used ${result.capabilities.tier}`);
	if (stats.frames < minFrames) problems.push(`measured only ${stats.frames} frames`);
	if (pacing && stats.intervalMs.median >= MAX_MEDIAN_INTERVAL_MS)
		problems.push(`median frame interval ${stats.intervalMs.median} ms`);
	// A page without cross-origin isolation gets a coarse timer (0.1 ms steps in Chrome), and an
	// empty frame can take less than one step.
	if (result.report.crossOriginIsolated && !(stats.cpuMs.median > 0))
		problems.push('no CPU time was recorded');
	for (const thread of expectedThreads(mode)) {
		if (!((stats.threads[thread]?.busyMs.count ?? 0) > 0))
			problems.push(`no frame records from the ${thread} thread`);
	}
	// The engine times one frame in every few while the page measures. Most of those must come
	// back: a browser that drops nearly all of them still has a few.
	const timestamps = tier === 'webgpu' && result.capabilities.features.includes('timestamp-query');
	const sampled = Math.floor(stats.frames / SAMPLED_EVERY);
	const gpuTimes = stats.gpuMs?.count ?? 0;
	if (timestamps && gpuTimes < Math.max(1, sampled / 2))
		problems.push(
			`GPU times for ${gpuTimes} of about ${sampled} sampled frames, although the device has timestamp queries`,
		);
	if (!((stats.completedFps ?? 0) > 0) || !((stats.gpuLatencyMs?.count ?? 0) > 0))
		problems.push('no frame completions were counted');
	// The job workers cull on WebGL2 and count the visible entries; on WebGPU the GPU culls.
	if (tier === 'webgl2' && !((stats.visibleEntries?.count ?? 0) > 0))
		problems.push('no visible entries were counted');
	if (tier === 'webgpu' && stats.visibleEntries !== null)
		problems.push('visible entries were counted, although the GPU culls');
	const signal = tier === 'webgl2' ? 'fence' : 'queue';
	if (stats.completionSignal !== signal)
		problems.push(`completions came from a ${stats.completionSignal}, expected a ${signal}`);
	const hz = stats.refreshHz ?? 0;
	const checkRefresh = pacing || stats.refreshHz !== null;
	if (checkRefresh && (hz < REFRESH_HZ_RANGE[0] || hz > REFRESH_HZ_RANGE[1]))
		problems.push(`measured a refresh rate of ${stats.refreshHz} Hz`);
	// With the sketch and the drawing in workers, the page's thread must stay free (design
	// principle 6).
	const pageFree = mode.renderThread !== 'main' && mode.sketchThread !== 'main';
	if (pageFree && (stats.mainThread?.longTasks ?? 0) > 0)
		problems.push(
			`the page's thread ran ${stats.mainThread?.longTasks} long tasks, up to ${stats.mainThread?.longestTaskMs} ms`,
		);
	if (!((stats.load.firstFrameMs ?? 0) > 0)) problems.push('the first frame time is missing');
	if (!((stats.load.firstFrameDoneMs ?? 0) > 0))
		problems.push('the time the GPU finished the first frame is missing');
	if (!(stats.load.probeMs > 0 && stats.load.coreMs > 0))
		problems.push('the probe or core load time is missing');
	if (result.stages.join(',') !== 'core,sketch,first-frame')
		problems.push(`the start reported the stages ${result.stages.join(', ')}`);
	if (result.messages.join(',') !== 'setup,count')
		problems.push(`the page received the sketch's messages ${result.messages.join(', ')}`);
	if (!((stats.memory.wasmBytes ?? 0) > 0)) problems.push('the WebAssembly memory size is missing');
	if (result.count.updates < minFrames)
		problems.push(`the sketch updated only ${result.count.updates} times`);
	if (!(result.stopMs < MAX_STOP_MS))
		problems.push(
			`the engine took ${Math.round(result.stopMs)} ms to stop: a job worker did not leave the job system`,
		);
	return problems;
}
