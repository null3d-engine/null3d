// Starts the engine with a small static scene, lets it draw a few frames, measures it, and
// captures the drawn frame through the engine, in the mode and on the GPU path the switches ask for.
import { createEngine } from '@sokko3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '1');

run('scene', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		game: new URL('./games/boxes-game.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const stats = await engine.measure(seconds);
	const capture = await engine.captureFrame();
	engine.destroy();
	return {
		mode: engine.mode,
		capabilities: engine.capabilities,
		stats,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
