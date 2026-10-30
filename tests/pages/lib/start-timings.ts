// Keeps one line in a page's trail that says where its start went: the time that the sketch's setup
// spent growing the scene, the pipelines that the first draw built and how long they took, the time
// that the first frame took, and how contended the machine was beside the page. The engine publishes
// its frame figures as the start makes them, so the line follows a start that never finishes: a page
// that times out quotes the trail's last steps, and the line among them names the phase that held it.
//
// The line is replaced in place, so it takes one step of the trail: three steps could leave the
// quoted ones, and a line per poll would push the page's own steps out of the quote.

import { MetricsReader } from '../../../packages/engine/src/shared/metrics';

/** How often the line follows the engine's figures, in milliseconds. */
const POLL_MS = 2000;

/** How many runs a calibration makes of its kernel: its reading is the fastest of them. */
const CALIBRATION_RUNS = 5;

/**
 * How many steps a calibration's kernel makes. A fixed count makes every reading the same work, so
 * a reading that takes longer means a busier processor rather than more work.
 */
const CALIBRATION_STEPS = 200_000;

/** The kernel's last value, which keeps the arithmetic from being dropped as unused. */
export const calibration = { value: 0 };

/**
 * Milliseconds that a fixed piece of arithmetic takes on this thread, the fastest of a few runs.
 * The page measures how contended its machine is, which a runner's own load figures do not show,
 * because a CI job sees the whole machine's load rather than the share of it that it may use.
 */
export function calibrate(): number {
	// A pass before the measured ones, so they read compiled code rather than the compiler's warm-up.
	let x = 1;
	for (let k = 0; k < CALIBRATION_STEPS; k++) x = (x * 1664525 + 1013904223) | 0;
	let fastest = Infinity;
	for (let run = 0; run < CALIBRATION_RUNS; run++) {
		const started = performance.now();
		for (let k = 0; k < CALIBRATION_STEPS; k++) x = (x * 1664525 + 1013904223) | 0;
		const ms = performance.now() - started;
		if (ms < fastest) fastest = ms;
	}
	calibration.value = x;
	return fastest;
}

/** How contended the page found its machine while its start ran. */
export interface Contention {
	/** Milliseconds that the fixed arithmetic took as the page started. */
	startMs: number;
	/** The slowest reading since, in milliseconds, or null before a later one ran. */
	worstMs: number | null;
}

/** The page's start reading, in milliseconds, or 0 before the page measured one. */
let startReadingMs = 0;

/**
 * Milliseconds that the page's fixed arithmetic took as its start began, or 0 before a start. It
 * reaches the page's result and the run's readings, whose spread says whether a page stood out.
 */
export function startCalibration(): number {
	return startReadingMs;
}

/** What the trail says about the page's machine beside its start timings. */
function contentionLine({ startMs, worstMs }: Contention): string {
	// A reading under the clock's resolution still reads as a speed, not as a division by zero.
	const base = Math.max(startMs, 0.001);
	const ratio = (worstMs ?? base) / base;
	return `calibration ${Math.round(startMs * 100) / 100} ms at the start, up to ${(ratio < 1 ? 1 : ratio).toFixed(1)}x slower later`;
}

/** What the trail says about `reader`'s start and machine, at the current time, in epoch milliseconds. */
export function timingsLine(reader: MetricsReader, now: number, contention: Contention): string {
	// Each time the page held a phase is an epoch millisecond, so a figure that a worker wrote
	// compares with the page's clock.
	const setupStart = reader.setupStart;
	const setupMs = reader.setupMs;
	const grew =
		setupMs !== null
			? `grew ${Math.round(setupMs)} ms`
			: setupStart > 0
				? `growing for ${Math.round(now - setupStart)} ms`
				: 'grew nothing yet';
	const pipelines = reader.firstFramePipelines;
	const warmUpStart = reader.warmUpStart;
	const warmUpMs = reader.warmUpMs;
	const built =
		pipelines !== null
			? `built ${pipelines} pipelines in ${Math.round(warmUpMs ?? 0)} ms`
			: warmUpStart > 0
				? `building pipelines for ${Math.round(now - warmUpStart)} ms`
				: 'built no pipelines yet';
	const drawMs = reader.firstDrawMs;
	const first = drawMs !== null ? `first frame ${Math.round(drawMs)} ms` : 'first frame not drawn';
	return `${grew}, ${built}, ${first}, ${contentionLine(contention)}`;
}

/**
 * Follows the start that the page makes, and keeps its line in `trail`. The engine publishes its
 * frame figures on the page as it makes them; a page that starts no engine notes nothing.
 */
export function watchStartTimings(trail: string[]): void {
	let reader: MetricsReader | undefined;
	let buffer: ArrayBufferLike | undefined;
	/** The place of this line in the trail, or -1 before the page noted one. */
	let at = -1;
	let line = '';
	// The page's speed at its start, and the slowest reading since, which says how contended the
	// machine was while the start ran. The readings stop at the first draw, so the figures stay the
	// ones that the start paid, not those of the page's later frames.
	const contention: Contention = { startMs: calibrate(), worstMs: null };
	startReadingMs = contention.startMs;
	// The page publishes the reading for a harness that times a page which never publishes a result.
	(globalThis as { __null3dStartCalibration?: number }).__null3dStartCalibration =
		contention.startMs;
	let drawn = false;
	const show = (text: string) => {
		if (text === line) return;
		line = text;
		if (at >= 0) trail.splice(at, 1);
		at = trail.length;
		trail.push(`${Math.round(performance.now())} ms ${text}`);
	};
	setInterval(() => {
		const next = (globalThis as { __null3dMetrics?: ArrayBufferLike }).__null3dMetrics;
		if (next === undefined) return;
		if (next !== buffer) {
			// A new engine starts its start again, so its readings begin at the page's start's speed.
			buffer = next;
			reader = new MetricsReader(next);
			contention.worstMs = null;
			drawn = false;
		}
		if (reader === undefined) return;
		if (!drawn) {
			const sample = calibrate();
			if (contention.worstMs === null || sample > contention.worstMs) contention.worstMs = sample;
			drawn = reader.firstDrawMs !== null;
		}
		show(timingsLine(reader, performance.timeOrigin + performance.now(), contention));
	}, POLL_MS);
}
