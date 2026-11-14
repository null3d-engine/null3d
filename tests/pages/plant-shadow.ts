// The shadow redraw count: a live engine draws a still camera over a row of plants whose material
// sways out to ?sway= metres, and measures the frame's draw calls. ?gpu= and ?preset= choose the GPU
// path and the preset, ?seconds= the first measured window and ?warmup= the seconds before it, and
// ?frames= the fewest frames that the measurement must hold, which grows the window on a slow GPU.
// The page reports what the sketch built, so a run can tell a page that used its query from one
// that did not.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The seconds that the first measurement window runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 3));
/** The fewest frames that the measurement must hold. */
const FRAMES = Math.max(1, Number(params.get('frames') ?? 1));
/**
 * The longest that the measurement window grows to, in seconds. A software WebGPU page drew three
 * frames in twenty-four seconds, so the window keeps doubling past that to reach the four it needs.
 */
const MAX_SECONDS = 60;
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
	// A software GPU draws one heavy frame over a second or more, so a fixed window can hold too
	// few frames for the far cascade's turns to show. The window doubles until the figures hold
	// the frames that the caller asks for, up to the longest window.
	let window = SECONDS;
	let stats = await engine.measure(window);
	while (stats.frames < FRAMES && window < MAX_SECONDS) {
		window = Math.min(window * 2, MAX_SECONDS);
		stats = await engine.measure(window);
	}
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
