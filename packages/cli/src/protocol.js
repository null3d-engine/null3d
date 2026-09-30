// The benchmark protocol that the bench command and the engine's own benchmarks share: fresh runs
// of a page, each measured after a warm-up that is not measured, then the median of the runs and
// their spread. The code is pure, so browser pages can load it too.

/** Seconds that a run lets the page run before it measures, so the browser optimizes its code. */
export const WARMUP_SECONDS = 5;

/** Seconds that a run measures. */
export const MEASURE_SECONDS = 30;

/** Fresh runs of each page. */
export const RUNS = 5;

/** @typedef {{ median: number, p95: number, p99: number, mean: number }} Percentiles */

/**
 * @typedef {object} ThreadFigures One thread's figures in `engine.measure`'s result.
 * @property {{ median: number }} busyMs CPU time per frame on the thread.
 * @property {Record<string, { median: number }>} phases CPU time per frame of each phase on it.
 */

/**
 * @typedef {object} EngineFigures The figures of `engine.measure`'s result that a summary reads
 *   besides the frame times of the run itself.
 * @property {{ median: number }} cpuMsAllThreads CPU time per frame summed over every thread.
 * @property {{ median: number } | null} gpuMs GPU time per frame, where the device times it.
 * @property {number} [presentedFps] Frames per second that the renderer presented.
 * @property {number | null} [completedFps] Frames per second that the GPU finished.
 * @property {{ median: number } | null} [gpuLatencyMs] Time from a frame's submit to the GPU
 *   finishing it.
 * @property {number | null} [refreshHz] The display's refresh rate, as the engine measured it.
 * @property {{ median: number }} uploadBytes Bytes uploaded per frame.
 * @property {{ median: number }} drawCalls Draw calls per frame.
 * @property {{ median: number } | null} [visibleEntries] Entries per frame in the list of visible
 *   objects; null where the GPU culls.
 * @property {Record<string, ThreadFigures>} threads Each thread's figures, by name.
 */

/**
 * @typedef {object} TimedRun What one measured run of a page gives.
 * @property {number} frames Frames measured after the warm-up.
 * @property {Percentiles} cpuMs CPU time per frame: the busiest thread for null3D, the main thread
 *   for pages that time their own frames.
 * @property {{ median: number, p95: number, p99: number }} intervalMs Time between presented
 *   frames.
 * @property {{ median: number }} [updateMs] Pages that time their own frames: the part of each
 *   frame that the scene update took.
 * @property {number} [presentedFps] Pages that time their own frames: frames per second drawn.
 * @property {EngineFigures} [stats] null3D pages: the figures of `engine.measure`.
 */

/**
 * @typedef {object} RunSummary Repeated runs of one page, summarized.
 * @property {number} runs
 * @property {{ median: number, min: number, max: number }} cpuMs The median of the runs' median
 *   CPU times, and their lowest and highest.
 * @property {number} cpuP95Ms
 * @property {number} intervalP95Ms Pacing: the median of the runs' 95th percentiles of the time
 *   between presented frames.
 * @property {number} intervalP99Ms Pacing: the median of the runs' 99th percentiles of the time
 *   between presented frames.
 * @property {number} [updateMs] The scene update's share of a frame: the sketch's update phase for
 *   null3D.
 * @property {number} [presentedFps] Frames per second drawn: each run's frames over the time they
 *   took.
 * @property {number} [allThreadsMs] null3D only: CPU time summed over threads.
 * @property {Record<string, number>} [threadsMs] null3D only: the median CPU time per frame of each
 *   thread, by name.
 * @property {number | null} [gpuMs] null3D only: GPU time per frame.
 * @property {Record<string, number>} [phases] null3D only: the median time of each phase, by
 *   thread and phase, such as `sketch-worker.update`.
 * @property {number} [uploadBytes]
 * @property {number} [drawCalls]
 * @property {number | null} [visibleEntries] null3D on WebGL2 only, where the job workers cull:
 *   entries per frame in the list of visible objects. Null where the GPU culls.
 * @property {number | null} [completedFps] null3D only: frames per second finished by the GPU.
 * @property {number | null} [gpuLatencyMs] null3D only: the GPU's delay.
 * @property {number | null} [refreshHz] null3D only: the display's refresh rate as the engine
 *   measured it.
 */

/**
 * @typedef {object} MeasuredEngine The part of a running engine that a timed run uses.
 * @property {(seconds: number) => Promise<EngineFigures & Pick<TimedRun, 'frames' | 'cpuMs' | 'intervalMs'>>} measure
 */

/**
 * Runs in the page: lets a running engine warm up, measures it, and returns the run. Tools send
 * this function to the page as its text, so it uses nothing from outside itself.
 *
 * @param {{ engine: MeasuredEngine, warmupSeconds: number, measureSeconds: number }} run
 * @returns {Promise<TimedRun>}
 */
export async function timedRun({ engine, warmupSeconds, measureSeconds }) {
	await new Promise((resolve) => setTimeout(resolve, warmupSeconds * 1000));
	const stats = await engine.measure(measureSeconds);
	return { frames: stats.frames, cpuMs: stats.cpuMs, intervalMs: stats.intervalMs, stats };
}

/**
 * The middle value, or the mean of the two middle values; 0 without values.
 *
 * @param {readonly number[]} values
 */
export function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	const upper = sorted[middle] ?? 0;
	return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/**
 * Adds a value to the list under a key, and starts the list when the key has none.
 *
 * @param {Record<string, number[]>} lists
 * @param {string} key
 * @param {number} value
 */
function addTo(lists, key, value) {
	const list = lists[key];
	if (list) list.push(value);
	else lists[key] = [value];
}

/**
 * The median of each key's values, by key.
 *
 * @param {Record<string, number[]>} lists
 * @returns {Record<string, number>}
 */
const medians = (lists) =>
	Object.fromEntries(Object.entries(lists).map(([key, values]) => [key, median(values)]));

/**
 * The values that are known.
 *
 * @template T
 * @param {(T | null | undefined)[]} values
 * @returns {T[]}
 */
const known = (values) => values.filter((v) => v != null);

/**
 * The median of the known values, or null without one.
 *
 * @param {(number | null | undefined)[]} values
 */
const knownMedian = (values) => {
	const found = known(values);
	return found.length > 0 ? median(found) : null;
};

/**
 * Summarizes runs of one page; failed runs must be left out first.
 *
 * @param {readonly TimedRun[]} results
 * @returns {RunSummary}
 */
export function summarizeRuns(results) {
	const cpu = results.map((r) => r.cpuMs.median);
	/** @type {RunSummary} */
	const summary = {
		runs: results.length,
		cpuMs: { median: median(cpu), min: Math.min(...cpu), max: Math.max(...cpu) },
		cpuP95Ms: median(results.map((r) => r.cpuMs.p95)),
		intervalP95Ms: median(results.map((r) => r.intervalMs.p95)),
		intervalP99Ms: median(results.map((r) => r.intervalMs.p99)),
	};
	const presented = knownMedian(results.map((r) => r.stats?.presentedFps ?? r.presentedFps));
	if (presented !== null) summary.presentedFps = presented;
	const updates = known(results.map((r) => r.updateMs?.median));
	if (updates.length === results.length) summary.updateMs = median(updates);
	const stats = known(results.map((r) => r.stats));
	if (stats.length === results.length && stats.length > 0) {
		summary.allThreadsMs = median(stats.map((s) => s.cpuMsAllThreads.median));
		summary.gpuMs = knownMedian(stats.map((s) => s.gpuMs?.median));
		summary.uploadBytes = median(stats.map((s) => s.uploadBytes.median));
		summary.drawCalls = median(stats.map((s) => s.drawCalls.median));
		summary.visibleEntries = knownMedian(stats.map((s) => s.visibleEntries?.median));
		summary.completedFps = knownMedian(stats.map((s) => s.completedFps));
		summary.gpuLatencyMs = knownMedian(stats.map((s) => s.gpuLatencyMs?.median));
		summary.refreshHz = knownMedian(stats.map((s) => s.refreshHz));
		/** @type {Record<string, number[]>} */
		const phases = {};
		/** @type {Record<string, number[]>} */
		const threads = {};
		for (const s of stats)
			for (const [thread, { busyMs, phases: byPhase }] of Object.entries(s.threads)) {
				addTo(threads, thread, busyMs.median);
				for (const [phase, { median: value }] of Object.entries(byPhase))
					addTo(phases, `${thread}.${phase}`, value);
			}
		summary.phases = medians(phases);
		summary.threadsMs = medians(threads);
		const update = summary.phases['sketch-worker.update'] ?? summary.phases['main.update'];
		if (update !== undefined) summary.updateMs = update;
	}
	return summary;
}

/**
 * Milliseconds for a report: two decimals, or n/a.
 *
 * @param {number | null | undefined} value
 */
export const ms = (value) => (value == null ? 'n/a' : value.toFixed(2));
