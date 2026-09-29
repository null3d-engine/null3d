// Cancels two starts of the engine, one before the GPU probe finishes and one once the core is
// ready, and reports how each rejected. Then starts an engine on a fresh canvas, which must run.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const sketch = new URL('./sketches/empty-sketch.ts', import.meta.url);

function freshCanvas(): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	document.body.append(canvas);
	return canvas;
}

async function cancelled(
	start: (controller: AbortController) => Promise<unknown>,
): Promise<string> {
	const controller = new AbortController();
	try {
		await start(controller);
		return 'started';
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

run('abort', async () => {
	const early = await cancelled((controller) => {
		const starting = createEngine({ canvas: freshCanvas(), sketch, signal: controller.signal });
		controller.abort(new Error('cancelled early'));
		return starting;
	});
	const late = await cancelled((controller) =>
		createEngine({
			canvas: freshCanvas(),
			sketch,
			signal: controller.signal,
			onProgress: (stage) => {
				if (stage === 'core') controller.abort(new Error('cancelled after the core'));
			},
		}),
	);
	const engine = await createEngine({ canvas: freshCanvas(), sketch });
	await engine.firstFrame;
	const stats = await engine.measure(0.5);
	await engine.destroy();
	return { early, late, framesAfter: stats.frames };
});
