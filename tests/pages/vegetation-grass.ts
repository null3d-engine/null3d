// What the grass costs at one preset and one GPU path: the frame's GPU time, its per-pass
// breakdown where the device times passes, its CPU time and its draw calls. ?preset= and the
// engine's ?gpu= choose them; ?seconds= the measured time. The vegetation grass plan runs it on
// each device.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { grassBands } from '@null3d/vegetation';
import { progress, run } from './lib/result';
import { GRASS } from './sketches/vegetation-grass-sketch';

const params = new URLSearchParams(location.search);
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 5));
/** The band that the page draws alone, so each band's cost reads on its own, or null for all. */
const BAND = params.get('band');

run('vegetation-grass', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/vegetation-grass-sketch.ts', import.meta.url);
	if (BAND !== null) sketch.searchParams.set('band', BAND);
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'high') as QualityPreset,
	});
	await engine.firstFrame;
	progress('the first frame drew');
	// Let the pipelines build and the first draws settle before the measurement.
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
		band: BAND ?? 'all',
		// The bands that the page draws, from the add-on's own plan: each band's distances, its tufts
		// at each preset, the triangles of one tuft, and the rows it allocates.
		bands: grassBands(GRASS).map(({ near, far, counts, triangles, rows, rowBytes }) => ({
			near,
			far,
			counts,
			triangles,
			rows,
			rowBytes,
		})),
		frames: stats.frames,
		gpuMs: stats.gpuMs,
		gpuPassMs: stats.gpuPassMs,
		cpuMs: stats.cpuMs,
		drawCalls: stats.drawCalls,
	};
});
