// Checks of the engine test page's result, shared by the Playwright tests and the real-browser runner.

export interface EngineMode {
	name: string;
	/** URL switches that select the mode. */
	query: string;
	build: 'threaded' | 'single';
	latency: 'pipelined' | 'low' | 'single';
	renderThread: 'render-worker' | 'game-worker' | 'main';
}

export const ENGINE_MODES: readonly EngineMode[] = [
	{
		name: 'pipelined',
		query: '',
		build: 'threaded',
		latency: 'pipelined',
		renderThread: 'render-worker',
	},
	{
		name: 'low latency',
		query: 'latency=low',
		build: 'threaded',
		latency: 'low',
		renderThread: 'game-worker',
	},
	{
		name: 'single-threaded',
		query: 'threads=off',
		build: 'single',
		latency: 'single',
		renderThread: 'main',
	},
	{
		name: 'drawing on the main thread',
		query: 'render=main',
		build: 'threaded',
		latency: 'pipelined',
		renderThread: 'main',
	},
];

interface Spread {
	count: number;
	median: number;
}

export interface EngineResult {
	mode: { build: string; latency: string; renderThread: string; jobWorkers: number };
	capabilities: { tier: string; threaded: boolean; features: string[] };
	stats: {
		frames: number;
		cpuMs: Spread;
		intervalMs: Spread;
		threads: Record<string, { busyMs: Spread }>;
		gpuMs: Spread | null;
		load: { firstFrameMs: number | null };
		memory: { wasmBytes: number | null };
	};
	count: { updates: number };
}

/** Slower than this median frame interval means the loop is not keeping up with the display. */
const MAX_MEDIAN_INTERVAL_MS = 34;
const MIN_FRAMES = 30;

/** The threads that record frames in a mode. */
function expectedThreads(mode: EngineMode): string[] {
	if (mode.latency === 'single') return ['main'];
	if (mode.renderThread === 'game-worker') return ['game-worker'];
	return ['game-worker', mode.renderThread];
}

/** What is wrong with a result of the engine page, run in a mode on a GPU tier; empty when nothing is. */
export function engineProblems(result: EngineResult, mode: EngineMode, tier: string): string[] {
	const problems: string[] = [];
	const { stats } = result;
	if (result.mode.build !== mode.build) problems.push(`loaded the ${result.mode.build} build`);
	if (result.mode.latency !== mode.latency) problems.push(`ran ${result.mode.latency} latency`);
	if (result.mode.renderThread !== mode.renderThread)
		problems.push(`drew on ${result.mode.renderThread}, expected ${mode.renderThread}`);
	if (result.mode.jobWorkers >= 1 !== (mode.build === 'threaded'))
		problems.push(`started ${result.mode.jobWorkers} job workers`);
	if (!result.capabilities.tier.startsWith(tier)) problems.push(`used ${result.capabilities.tier}`);
	if (stats.frames <= MIN_FRAMES) problems.push(`measured only ${stats.frames} frames`);
	if (stats.intervalMs.median >= MAX_MEDIAN_INTERVAL_MS)
		problems.push(`median frame interval ${stats.intervalMs.median} ms`);
	if (!(stats.cpuMs.median > 0)) problems.push('no CPU time was recorded');
	for (const thread of expectedThreads(mode)) {
		if (!((stats.threads[thread]?.busyMs.count ?? 0) > 0))
			problems.push(`no frame records from the ${thread} thread`);
	}
	const timestamps = tier === 'webgpu' && result.capabilities.features.includes('timestamp-query');
	if (timestamps && !((stats.gpuMs?.count ?? 0) > 0))
		problems.push('no GPU times, although the device has timestamp queries');
	if (!((stats.load.firstFrameMs ?? 0) > 0)) problems.push('the first frame time is missing');
	if (!((stats.memory.wasmBytes ?? 0) > 0)) problems.push('the WebAssembly memory size is missing');
	if (result.count.updates <= MIN_FRAMES)
		problems.push(`the game updated only ${result.count.updates} times`);
	return problems;
}
