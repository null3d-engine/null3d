// Starts the engine with an empty game in the mode the URL's switches ask for, measures it for a few
// seconds, then reports the mode, the capabilities, the frame metrics and how many times the game
// updated.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '2');

run('engine', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		game: new URL('./games/empty-game.ts', import.meta.url),
	});
	const stats = await engine.measure(seconds);
	const count = await new Promise<unknown>((resolve) => {
		engine.onGameMessage((name, data) => {
			if (name === 'count') resolve(data);
		});
		engine.postToGame('count');
	});
	const capture = params.has('capture') ? await engine.captureFrame() : undefined;
	engine.destroy();
	return {
		mode: engine.mode,
		capabilities: engine.capabilities,
		report: engine.report,
		stats,
		count,
		capture: capture && {
			width: capture.width,
			height: capture.height,
			pixels: toBase64(capture.pixels),
		},
	};
});
