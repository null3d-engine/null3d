// Measures a running engine until the measurements hold what a test needs, such as enough frames,
// for the tests that count work over frames. A software GPU on a busy machine can take more than a
// second for a frame, and a measurement counts only the frames that start and end within it. So
// each further measurement is twice as long as the one before, or repeats as it is while the
// engine draws nothing at all.
import type { Engine, FrameMetrics } from '@null3d/engine';

/**
 * Measures the engine for `seconds`, then again for twice as long each time, until `enough` returns
 * true or the measurement has doubled `doublings` times. Each measurement goes to `add`, with its
 * length in seconds.
 */
export async function measureUntil(
	engine: Engine,
	seconds: number,
	doublings: number,
	add: (stats: FrameMetrics, seconds: number) => void,
	enough: () => boolean,
): Promise<void> {
	for (let k = 0; k <= doublings; k++) {
		const length = seconds * 2 ** k;
		add(await engine.measure(length), length);
		if (enough()) return;
	}
}

/**
 * The frames that a running engine draws, in windows of `seconds` that repeat while the engine
 * draws none: a software GPU on a busy machine can take longer than one window for a frame. The
 * engine gets `windows` windows before the caller reads a count of none as an engine that does not
 * draw.
 */
export async function framesDrawn(engine: Engine, seconds = 0.5, windows = 10): Promise<number> {
	let frames = 0;
	for (let window = 0; window < windows && frames === 0; window++)
		frames = (await engine.measure(seconds)).frames;
	return frames;
}

/**
 * Measures the engine for `seconds`, then again for twice as long each time while the measurement
 * holds no frame: a software GPU on a busy machine can take longer than one window for a frame, and
 * a window without one says nothing about the work the engine does. A repeat of the same window
 * never holds a frame that does not fit, so each further window doubles. The last measurement comes
 * back after `windows` measurements, whatever it holds.
 */
export async function measureDrawing(
	engine: Engine,
	seconds: number,
	windows = 4,
): Promise<FrameMetrics> {
	let stats: FrameMetrics | undefined;
	await measureUntil(
		engine,
		seconds,
		windows - 1,
		(more) => {
			stats = more;
		},
		() => (stats?.frames ?? 0) > 0,
	);
	if (!stats) throw new Error('the page took no measurement');
	return stats;
}
