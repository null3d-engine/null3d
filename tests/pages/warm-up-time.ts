// Times the start of a sketch, as a loading screen covers it: from createEngine until the first frame
// is on screen, the part of it that the GPU pipelines take, and createEngine's own time, which on a
// first visit holds the preset check that runs after the first frame. ?sketch= names the sketch module from
// the server's root, with the sketch's own query after it. The canvas fills the window at the pixel
// ratio of the preset that the engine chooses, as an app's does. The engine reads its own switches:
// ?gpu=, the thread mode's, ?shaders=fresh, which makes the browser compile every shader again
// instead of reusing what it compiled before, and ?check=fresh, which measures the preset again
// instead of taking the stored result of an earlier preset check, both as on a first visit.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** How long the page measures the engine after the first frame, for its load figures. */
const MEASURE_SECONDS = 0.25;

const params = new URLSearchParams(location.search);

run('warm-up-time', async () => {
	const sketch = params.get('sketch');
	if (!sketch?.startsWith('/'))
		throw new Error('Add ?sketch= with the path of a sketch module from the server root.');
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const started = performance.now();
	const engine = await createEngine({ canvas, sketch: new URL(sketch, location.origin) });
	const engineStartMs = performance.now() - started;
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	await engine.firstFrame;
	const metrics = await engine.measure(MEASURE_SECONDS);
	// The engine notes when the GPU finished the first frame, which can come long before
	// createEngine resolves. Both clocks count from the page's time origin.
	const firstFrameShownMs = (metrics.load.firstFrameDoneMs ?? performance.now()) - started;
	await engine.destroy();
	const { tier, features } = engine.capabilities;
	return {
		tier,
		mode: engine.mode,
		backgroundCompile: tier === 'webgl2' ? features.includes('KHR_parallel_shader_compile') : null,
		freshShaders: params.get('shaders') === 'fresh',
		engineStartMs,
		firstFrameShownMs,
		warmUpMs: metrics.load.warmUpMs,
		firstDrawMs: metrics.load.firstDrawMs,
		pipelines: metrics.load.firstFramePipelines,
		failures,
	};
});
