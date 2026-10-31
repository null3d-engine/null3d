// What moving a grove's near trees costs at one preset and GPU path: the per-vertex sway, or a
// compute pass's branch poses, which keep a spring. The page times the frames at a fixed preset and
// GPU path and reports the GPU time with its parts, the CPU time and the draw calls (?method=,
// ?preset= and ?gpu= choose them). ?scale=0.25 draws the same grove at a quarter of the render
// scale with the sun's shadows off, which leaves a sixteenth of the fragment work and none of the
// shadow cascades' work, so the frame's figure follows the vertex work that the two methods differ
// in. The vegetation poses plan runs it on each device, and M3-V10 records
// the figures per preset and path.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 5));
/** The method that moves the branches: the per-vertex sway, or the pass's branch poses. */
const METHOD = params.get('method') === 'poses' ? 'poses' : 'vertex';
/** The render scale that the page holds, or nothing for the preset's own. */
const SCALE = params.get('scale');

run('vegetation-poses-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/vegetation-wind-sketch.ts', import.meta.url);
	if (METHOD === 'poses') sketch.searchParams.set('method', 'poses');
	if (params.has('sway')) sketch.searchParams.set('sway', String(params.get('sway')));
	if (SCALE !== null) sketch.searchParams.set('scale', SCALE);
	// The measurement stands the copies close, so a preset's sway distance takes many of them.
	sketch.searchParams.set('dense', '1');
	// A page at a small render scale turns the shadows off, so its frame follows the vertex work of
	// the camera's passes rather than the shadow cascades, which keep their size.
	if (SCALE !== null) sketch.searchParams.set('noshadow', '1');
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'low') as QualityPreset,
	});
	await engine.firstFrame;
	progress('the first frame drew');
	// Let the pipelines build and the first cascade layers fill before the measurement.
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const stats = await engine.measure(SECONDS);
	const mode = {
		method: METHOD,
		scale: SCALE === null ? 1 : Number(SCALE),
		tier: engine.capabilities.tier,
		preset: engine.mode.preset,
		window: [innerWidth, innerHeight] as const,
		devicePixelRatio,
	};
	await engine.destroy();
	return {
		...mode,
		frames: stats.frames,
		gpuMs: stats.gpuMs,
		gpuPassMs: stats.gpuPassMs,
		cpuMs: stats.cpuMs,
		drawCalls: stats.drawCalls,
	};
});
