// The shadow redraws of a still camera over a swaying grove: the frame's draw calls, which include
// one draw for each plant part in every shadow cascade that draws. ?sway=<metres> sets how far from
// the camera the plants move. With the distance inside the grove, the far trees stand still, so a
// far cascade that keeps its layer need not draw again; with 0, every tree sways and every far
// cascade draws in every frame. ?far places every row past the near cascades, so only the far ones
// reach the grove, and ?still holds the air. The camera holds still, so nothing but the plants can
// redraw a cascade.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** How far from the camera the plants sway, in meters: 0 moves them at every distance. */
const SWAY = Math.max(0, Number(params.get('sway') ?? 16));
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(0.5, Number(params.get('seconds') ?? 2));

run('vegetation-shadow-count', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/vegetation-wind-sketch.ts', import.meta.url);
	sketch.searchParams.set('sway', String(SWAY));
	if (params.has('far')) sketch.searchParams.set('far', '');
	if (params.has('still')) sketch.searchParams.set('still', '');
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'low') as QualityPreset,
	});
	await engine.firstFrame;
	// The first frames rebuild the draw tables and fill each cascade's layer, so the count settles
	// after them.
	progress('the first frame drew');
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const stats = await engine.measure(SECONDS);
	const mode = { tier: engine.capabilities.tier, preset: engine.mode.preset };
	await engine.destroy();
	return {
		...mode,
		swayDistance: SWAY,
		far: params.has('far'),
		still: params.has('still'),
		frames: stats.frames,
		drawCalls: stats.drawCalls.median,
		gpuMs: stats.gpuMs?.median ?? null,
	};
});
