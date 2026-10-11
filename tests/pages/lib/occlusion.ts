// What the occlusion pages share: the figures of a measurement with occlusion culling off or on,
// the medians of their rounds, the count of pixels where two frames differ, and S6's occlusion
// turns (T-36): the order of each round's two sides, and the two popping figures. Wrongly hidden
// at rest compares frames with culling off and on at stops along the route, with the camera still.
// Late in motion counts the objects that show frames late while the camera flies, from the visual
// check's popping figure. The device runner judges and tables the turns' results with the same
// rules (tests/lib/occlusion-s6.ts). Nothing here needs the engine or a browser.
/** The middle of some numbers, nulls left out, or null without any. */
export function median(values: readonly (number | null)[]): number | null {
	const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Pixels whose color differs between two RGBA frames of the same size. */
export function differingPixels(a: Uint8Array, b: Uint8Array): number {
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
	return count;
}

/**
 * The figures of one measurement that the occlusion pages report, as medians per frame: the
 * busiest thread's CPU time, every thread's together, the sketch thread's time and its culling
 * step, the render worker's time, the job workers' time together, the GPU time where the device
 * has a timer, the frame interval, the draw calls, and the index list entries that the frame drew
 * and that occlusion culling hid. ./occlusion-figures.ts reads them from `engine.measure`.
 */
export interface OcclusionFigures {
	cpuMs: number | null;
	cpuMsAllThreads: number | null;
	sketchMs: number | null;
	cullMs: number | null;
	renderMs: number | null;
	jobsMs: number | null;
	gpuMs: number | null;
	intervalMs: number | null;
	drawCalls: number | null;
	visibleEntries: number | null;
	occludedEntries: number | null;
}

/** The names of the figures, in the order the pages report them. */
const FIGURES: readonly (keyof OcclusionFigures)[] = [
	'cpuMs',
	'cpuMsAllThreads',
	'sketchMs',
	'cullMs',
	'renderMs',
	'jobsMs',
	'gpuMs',
	'intervalMs',
	'drawCalls',
	'visibleEntries',
	'occludedEntries',
];

/** Each figure's median over the rounds of one side, null for a figure that no round measured. */
export function medianFigures(runs: readonly OcclusionFigures[]): OcclusionFigures {
	return Object.fromEntries(
		FIGURES.map((key) => [key, median(runs.map((run) => run[key]))]),
	) as unknown as OcclusionFigures;
}

/** A side of the turns: occlusion culling off or on. */
export type OcclusionSide = 'off' | 'on';

/**
 * The sides of a round in the order they run: off first in even rounds and on first in odd ones,
 * so a device that warms through the turns slows both sides alike.
 */
export const roundSides = (round: number): readonly OcclusionSide[] =>
	round % 2 === 0 ? ['off', 'on'] : ['on', 'off'];

/**
 * Where each round flies: the share of the route where its sides start. The rounds spread over
 * the route, and both sides of a round fly the same stretch.
 */
export const roundStart = (round: number, rounds: number): number => round / rounds;

/** The shares of the route where the check at rest stops, evenly spread, none at the start. */
export const stopShares = (count: number): number[] =>
	Array.from({ length: count }, (_, k) => (k + 0.5) / count);

/**
 * Pixels that a frame with culling on may differ from the frame with it off, past what two frames
 * with it off differ at the same stop. A small prop far down a street covers about this many, so a
 * missing object shows above it.
 */
export const AT_REST_MARGIN_PIXELS = 8;

/**
 * Stops where culling may hide what shows before the check fails: none. The culling hides only
 * what lies wholly behind blockers, so one such stop is a fault.
 */
export const AT_REST_LIMIT = 0;

/**
 * Objects that may show late in motion before the check fails: none. The culling uses the frame's
 * own camera and keeps no history, so no object can show a frame late.
 */
export const LATE_IN_MOTION_LIMIT = 0;

/**
 * One stop of the check at rest: its share of the route, the pixels where two captures with
 * culling off differ, which is the device's noise, and the pixels where the capture with culling
 * on differs from the first capture with it off.
 */
export interface OcclusionStop {
	share: number;
	noise: number;
	differing: number;
}

/** True when culling hid something at a stop that shows with culling off. */
export const hiddenAtRest = ({ noise, differing }: OcclusionStop): boolean =>
	differing > noise + AT_REST_MARGIN_PIXELS;

/** What S6's page reports from its occlusion turns. */
export interface OcclusionTurnsResult {
	/** The GPU path, the quality preset and the buffer size switch, or null for the default. */
	tier: string;
	preset: string;
	buffer: string | null;
	/** The window in CSS pixels, the device's pixel ratio and the render scale that the frames held. */
	window: [number, number];
	devicePixelRatio: number;
	renderScale: number | null;
	/** Rounds of the two sides, and the seconds each side measured in each round. */
	rounds: number;
	seconds: number;
	/** Each side's figures: the medians of its rounds. */
	off: OcclusionFigures;
	on: OcclusionFigures;
	/** The stops of the check at rest along the route. */
	stops: OcclusionStop[];
	/**
	 * The objects that showed frames late while the camera flew the route, from the visual check's
	 * popping figure on the same flight with culling off and on. Absent until the page runs it.
	 */
	lateInMotion?: number | null;
	/**
	 * PNG files in base64 of the stops where culling hid what shows, as `stop-<k>-off` and
	 * `stop-<k>-on`.
	 */
	images?: Record<string, string>;
	failures: string[];
}

/**
 * What a turns result says about T-36. The hidden share counts the entries that the culling took
 * out of those that passed the frustum test. The added CPU time is the job workers' added time and
 * the sketch thread's added culling step, which includes the calling thread's share of the
 * blockers' drawing. The saved times are the render worker's and the GPU's, the GPU's null where
 * the device has no GPU timer, and the frame interval's. Culling pays where the render worker and
 * the GPU save more than the culling adds, and nothing pops: no stop hides what shows at rest, and
 * no object shows late in motion where the page measured it.
 */
export function occlusionVerdict({ off, on, stops, lateInMotion = null }: OcclusionTurnsResult) {
	const less = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
	const visible = on.visibleEntries ?? 0;
	const hidden = on.occludedEntries ?? 0;
	const addedCpuMs = (less(on.jobsMs, off.jobsMs) ?? 0) + (less(on.cullMs, off.cullMs) ?? 0);
	const savedRenderMs = less(off.renderMs, on.renderMs);
	const savedGpuMs = less(off.gpuMs, on.gpuMs);
	const savedMs = (savedRenderMs ?? 0) + (savedGpuMs ?? 0);
	const hiddenStops = stops.filter(hiddenAtRest).length;
	return {
		hiddenShare: visible + hidden > 0 ? hidden / (visible + hidden) : 0,
		addedCpuMs,
		savedRenderMs,
		savedGpuMs,
		savedIntervalMs: less(off.intervalMs, on.intervalMs),
		hiddenStops,
		lateInMotion,
		pays:
			savedMs > addedCpuMs &&
			hiddenStops <= AT_REST_LIMIT &&
			(lateInMotion === null || lateInMotion <= LATE_IN_MOTION_LIMIT),
	};
}

/**
 * What is wrong with a turns result as a measurement: a failure, a side that measured no frame,
 * culling that hid nothing in the city, or a check at rest that compared no stop.
 */
export function occlusionMeasurementProblems(result: OcclusionTurnsResult): string[] {
	const problems = (result.failures ?? []).map((code) => `the engine failed with ${code}`);
	for (const side of ['off', 'on'] as const)
		if (!result[side]?.intervalMs) problems.push(`the page measured no frame with culling ${side}`);
	if (!result.on?.occludedEntries) problems.push('occlusion culling hid nothing in the city');
	if (!result.stops?.length) problems.push('the check at rest compared no stop');
	return problems;
}

/**
 * The popping of a turns result: each stop where culling hid what shows at rest, and the objects
 * that showed late in motion past the limit.
 */
export function poppingProblems(result: OcclusionTurnsResult): string[] {
	const problems = (result.stops ?? []).flatMap((stop, k) =>
		hiddenAtRest(stop)
			? [
					`wrongly hidden at rest: stop ${k} at ${(100 * stop.share).toFixed(1)}% of the route differs from culling off in ${stop.differing} pixels, past the ${stop.noise} that two frames with culling off differ`,
				]
			: [],
	);
	const late = result.lateInMotion ?? 0;
	if (late > LATE_IN_MOTION_LIMIT) problems.push(`late in motion: ${late} objects showed late`);
	return problems;
}

/** Everything wrong with a turns result: its measurement's problems, then its popping. */
export const occlusionTurnsProblems = (result: OcclusionTurnsResult): string[] => [
	...occlusionMeasurementProblems(result),
	...poppingProblems(result),
];
