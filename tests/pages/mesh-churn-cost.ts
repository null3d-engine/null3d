// Measures what a frame costs when a model's mesh leaves the scene, and when one arrives, on this
// computer's GPU: the models of tests/pages/sketches/mesh-churn-cost-sketch.ts fill the view, and
// the page measures an idle window, a window that removes one model a frame, and a window that
// adds one a frame, in turns, three times each. A removal that closes a hole in its mesh page moves
// every mesh after it in that page, which the GPU uploads again, so the render worker's CPU time
// and the frame's upload bytes show the cost. It prints its figures for D-244.
// Open it with ?gpu= for each path, and read it with mesh-churn-cost.spec.ts.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { run } from './lib/result';

/** Seconds of each measured window. */
const WINDOW = 1.2;
/** Windows of each kind. */
const TRIALS = 3;

interface Side {
	frames: number;
	intervalMs: number;
	renderWorkerMs: number;
	/** The sketch worker's own code: where a removal or an addition runs. */
	sketchMs: number | null;
	uploadBytes: number;
	gpuMs: number | null;
}

/** The figures of one window that the record reads. */
function side(metrics: FrameMetrics): Side {
	const drawing = metrics.threads['render-worker'];
	const sketching = metrics.threads['sketch-worker'] ?? metrics.threads.main;
	return {
		frames: metrics.frames,
		intervalMs: metrics.intervalMs.median,
		renderWorkerMs: drawing ? drawing.busyMs.mean : metrics.cpuMs.mean,
		// A mesh that leaves is freed in the sketch worker's own code, and its page's bytes upload
		// again on the drawing thread.
		sketchMs: sketching?.phases.update?.mean ?? null,
		uploadBytes: metrics.uploadBytes.mean,
		gpuMs: metrics.gpuMs ? metrics.gpuMs.median : null,
	};
}

run('mesh-churn-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/mesh-churn-cost-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		preset: 'low',
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const phase = async (name: 'idle' | 'destroy' | 'create') => {
		engine.postToSketch(name, null);
		return side(await engine.measure(WINDOW));
	};
	const idle: Side[] = [];
	const destroy: Side[] = [];
	const create: Side[] = [];
	for (let trial = 0; trial < TRIALS; trial++) {
		// A window that changes nothing, so the churn's extra time shows against it.
		idle.push(await phase('idle'));
		destroy.push(await phase('destroy'));
		create.push(await phase('create'));
		// The next trial measures an idle window again once the models are back.
	}
	engine.postToSketch('idle', null);
	const mode = engine.mode;
	const capabilities = engine.capabilities;
	await engine.destroy();
	return {
		tier: capabilities.tier,
		threads: mode.renderThread,
		window: [innerWidth, innerHeight],
		models: 240,
		trialSeconds: WINDOW,
		idle,
		destroy,
		create,
		failures,
	};
});
