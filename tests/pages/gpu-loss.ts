// Takes the GPU away from a running engine and reports what the page hears. By default it draws with
// WebGL2 on the page's thread (with ?threads=off or ?render=main) and takes the context away for
// good, so the engine gives up and reports E1302. With ?simulate, it calls engine.simulateGpuLoss
// in any mode, so the GPU comes back and the engine must carry on drawing without a failure.
import { createEngine, type EngineError } from '@null3d/engine';
import { run } from './lib/result';

/** How long the engine draws before the loss, and how long the page waits for a report. */
const DRAW_MS = 300;
const REPORT_MS = 10_000;
/** How long a simulated loss has to recover before the page measures the frames drawn after it. */
const RECOVERY_MS = 1000;

const params = new URLSearchParams(location.search);

run('gpu-loss', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		game: new URL('./games/empty-game.ts', import.meta.url),
	});
	let failure: EngineError | null = null;
	engine.onFailure((error) => {
		failure = error;
	});
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	if (params.has('simulate')) {
		engine.simulateGpuLoss();
		await new Promise((resolve) => setTimeout(resolve, RECOVERY_MS));
		const after = await engine.measure(0.5);
		engine.destroy();
		return {
			mode: engine.mode,
			tier: engine.capabilities.tier,
			code: failure,
			framesAfter: after.frames,
		};
	}
	canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
	const deadline = performance.now() + REPORT_MS;
	while (!failure && performance.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 100));
	engine.destroy();
	const code = (failure as EngineError | null)?.code ?? null;
	return { mode: engine.mode, tier: engine.capabilities.tier, code };
});
