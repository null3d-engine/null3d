// Starts the engine with an empty game in the mode the URL's switches ask for, measures it for a few
// seconds, then reports the mode, the capabilities, the frame metrics, how many times the game
// updated and its largest step. With ?pause, it pauses and resumes the game before it asks.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '2');
/** How long `?pause` pauses the game. */
const PAUSE_MS = 600;

run('engine', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stages: string[] = [];
	const engine = await createEngine({
		canvas,
		game: new URL('./games/empty-game.ts', import.meta.url),
		onProgress: (stage) => stages.push(stage),
	});
	await engine.firstFrame;
	const stats = await engine.measure(seconds);
	if (params.has('pause')) {
		// A pause the game must not see as one long step.
		engine.setPaused(true);
		await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
		engine.setPaused(false);
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
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
		stages,
		count,
		capture: capture && {
			width: capture.width,
			height: capture.height,
			pixels: toBase64(capture.pixels),
		},
	};
});
