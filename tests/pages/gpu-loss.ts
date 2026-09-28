// Starts the engine drawing with WebGL2 on the page's thread (with ?threads=off or ?render=main),
// takes the WebGL2 context away the way a driver reset does, and reports the failure the engine
// sends to the page.
import { createEngine, type EngineError } from '@null3d/engine';
import { run } from './lib/result';

/** How long the engine draws before the loss, and how long the page waits for the report. */
const DRAW_MS = 300;
const REPORT_MS = 5000;

run('gpu-loss', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		game: new URL('./games/empty-game.ts', import.meta.url),
	});
	const failure = new Promise<EngineError | null>((resolve) => {
		engine.onFailure(resolve);
		setTimeout(() => resolve(null), DRAW_MS + REPORT_MS);
	});
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
	const error = await failure;
	engine.destroy();
	return { mode: engine.mode, tier: engine.capabilities.tier, code: error?.code ?? null };
});
