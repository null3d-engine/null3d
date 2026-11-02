// Measures a scene that draws itself a second time for a reflection, with a compute pass whose
// WebGL2 form is a fragment pass: the bytes that each frame uploads, the frame interval and the draw
// calls. Its switches leave out the pass, the reflection or the compressed-texture model, so each
// part's share of the uploads shows. ?seconds= sets the measured time, and ?settle= the seconds that
// the page draws first, so a plan's first build and a pipeline's lie outside the measure.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const SECONDS = Number(params.get('seconds') ?? 5);
/** The seconds to draw before the measure, so a plan's first build and a pipeline's lie outside it. */
const SETTLE = Number(params.get('settle') ?? 0);

run('reupload', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/reupload-sketch.ts', import.meta.url);
	for (const id of ['pass', 'reflect', 'model', 'every', 'recompile', 'governor']) {
		if (params.has(id)) sketch.searchParams.set(id, params.get(id) ?? '');
	}
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	await engine.firstFrame;
	progress('the first frame drew');
	if (SETTLE > 0) {
		await new Promise((resolve) => setTimeout(resolve, SETTLE * 1000));
		progress(`settled for ${SETTLE} s`);
	}
	const metrics = await engine.measure(SECONDS);
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	await engine.destroy();
	if (!(metrics.presentedFps > 0))
		throw new Error(`the measure drew no frame in ${metrics.seconds.toFixed(1)} s`);
	return {
		tier,
		mode,
		pass: params.get('pass') !== '0',
		reflect: params.get('reflect') !== '0',
		model: params.get('model') !== '0',
		seconds: metrics.seconds,
		frames: metrics.frames,
		presentedFps: metrics.presentedFps,
		intervalMs: metrics.intervalMs,
		uploadBytes: metrics.uploadBytes,
		drawCalls: metrics.drawCalls,
		gpuObjects: metrics.gpuObjects,
		skippedDraws: metrics.skippedDraws,
		pipelines: metrics.pipelines,
		failures,
	};
});
