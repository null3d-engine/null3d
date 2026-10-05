// Measures a running engine until the measurements hold what a test needs, such as enough frames,
// for the tests that count work over frames. A software GPU on a busy machine can take more than a
// second for a frame, and a measurement counts only the frames that start and end within it. So
// each further measurement is twice as long as the one before.
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
