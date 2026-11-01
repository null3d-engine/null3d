// What one more texture read for each vertex costs a flag and a water surface: the sketch draws the
// reader with `?read=off` and `?read=on`, and this page measures one side's frame. The plan runs the
// two sides and both readers on each GPU path, so the difference between the sides is the read.
// Open it with ?reader=flag|water, ?read=on|off and ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The reader that the page draws: a flag or a water surface. */
const READER = params.get('reader') === 'water' ? 'water' : 'flag';
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 3));
/** True to read the field; ?read=off draws the reader without it. */
const READS = params.get('read') !== 'off';

run('wind-reader-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const query = new URLSearchParams({ reader: READER, read: READS ? 'on' : 'off' });
	const engine = await createEngine({
		canvas,
		sketch: new URL(`./sketches/wind-reader-cost-sketch.ts?${query}`, import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	progress('the first frame drew');
	// Let the pipelines build and the field settle before the measurement.
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const stats = await engine.measure(SECONDS);
	const mode = {
		tier: engine.capabilities.tier,
		preset: engine.mode.preset,
		window: [innerWidth, innerHeight] as const,
		devicePixelRatio,
	};
	await engine.destroy();
	return {
		...mode,
		reader: READER,
		reads: READS,
		frames: stats.frames,
		gpuMs: stats.gpuMs,
		gpuPassMs: stats.gpuPassMs,
		cpuMs: stats.cpuMs,
		drawCalls: stats.drawCalls,
	};
});
