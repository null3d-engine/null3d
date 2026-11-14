// What two ways for leaves to ride the air cost at 500, 2,000 and 10,000 leaves: the sketch draws
// one form and one count, and this page measures its frame. The plan runs each form and count on
// each GPU path, so the two forms compare at the same load. Open it with ?ride=offset|state,
// ?count= and ?gpu= for each path.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The form that the page draws. */
const RIDE = params.get('ride') === 'offset' ? 'offset' : 'state';
/** The leaves that the page asks for. */
const COUNT = Math.max(1, Math.floor(Number(params.get('count') ?? 500)));
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 3));

run('leaves-wind-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const query = new URLSearchParams({ ride: RIDE, count: String(COUNT) });
	const engine = await createEngine({
		canvas,
		sketch: new URL(`./sketches/leaves-wind-cost-sketch.ts?${query}`, import.meta.url),
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'high') as QualityPreset,
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
		ride: RIDE,
		count: COUNT,
		frames: stats.frames,
		gpuMs: stats.gpuMs,
		gpuPassMs: stats.gpuPassMs,
		cpuMs: stats.cpuMs,
		drawCalls: stats.drawCalls,
	};
});
