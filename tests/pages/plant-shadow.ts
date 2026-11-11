// The shadow redraw count: a live engine draws a still camera over a row of plants whose material
// sways out to ?sway= metres, and measures the frame's draw calls. ?gpu= and ?preset= choose the GPU
// path and the preset; ?seconds= the measured time and ?warmup= the seconds before it. The page
// reports what the sketch built, so a run can tell a page that used its query from one that did not.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 3));
/** The seconds that the pipelines build before the measurement. */
const WARMUP = Math.max(0, Number(params.get('warmup') ?? 2));

run('plant-shadow', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/plant-shadow-sketch.ts', import.meta.url);
	// The sketch reads the row and the sway distance from its own address.
	for (const name of ['sway', 'wind', 'plants', 'distance']) {
		const value = params.get(name);
		if (value !== null) sketch.searchParams.set(name, value);
	}
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'high') as QualityPreset,
	});
	// The sketch posts its values at setup, long before the measurement ends.
	const messages: Record<string, unknown> = {};
	engine.onSketchMessage((name, data) => {
		messages[name] = data;
	});
	await engine.firstFrame;
	progress('the first frame drew');
	await new Promise((resolve) => setTimeout(resolve, WARMUP * 1000));
	const stats = await engine.measure(SECONDS);
	const mode = { tier: engine.capabilities.tier, preset: engine.mode.preset };
	await engine.destroy();
	return {
		...mode,
		frames: stats.frames,
		drawCalls: stats.drawCalls,
		triangles: stats.triangles,
		built: messages['plant-shadow'] ?? null,
	};
});
