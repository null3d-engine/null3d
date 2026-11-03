// What a frame's near shoots cost at one preset, one GPU path and one triangle budget: the frame's
// GPU time, its per-pass breakdown where the device times passes, its CPU time and its draw calls,
// beside the triangles that the near pool drew. ?preset= and the engine's ?gpu= choose the preset
// and the path, ?triangles= the budget (0 for every copy on its cards), ?aa= the antialiasing, which
// stays fixed while an engine runs, and ?seconds= the measured time. The sketch's own switches take
// the frame apart, one part at a time. The near shoots plan runs it on each device; the difference from the page at 0 is what the
// near shoots cost.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The seconds that the measurement runs for. */
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 5));
/** The longest the page waits for the oaks to grow and the near pool to answer, in milliseconds. */
const SETTLE_MS = 300_000;

run('near-shoots', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	let near: unknown;
	// The sketch reads the page's own query: the budget.
	const sketch = new URL('./sketches/near-shoots-sketch.ts', import.meta.url);
	sketch.search = location.search;
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'high') as QualityPreset,
		...(params.has('aa') && { antialias: params.get('aa') as 'msaa' | 'fxaa' | 'none' }),
	});
	engine.onSketchMessage((name, data) => {
		if (name === 'near') near = data;
	});
	await engine.firstFrame;
	progress('the first frame drew');
	const started = performance.now();
	while (near === undefined && performance.now() - started < SETTLE_MS)
		await new Promise((resolve) => setTimeout(resolve, 200));
	if (near === undefined) throw new Error('the near pool did not answer in time');
	progress('the near pool answered');
	// Let the pipelines build and the first draws settle before the measurement.
	await new Promise((resolve) => setTimeout(resolve, 3000));
	const stats = await engine.measure(SECONDS);
	const mode = {
		tier: engine.capabilities.tier,
		preset: engine.mode.preset,
		window: [innerWidth, innerHeight] as const,
		devicePixelRatio,
	};
	await engine.destroy();
	return {
		...mode,
		near,
		frames: stats.frames,
		gpuMs: stats.gpuMs,
		gpuPassMs: stats.gpuPassMs,
		cpuMs: stats.cpuMs,
		drawCalls: stats.drawCalls,
		triangles: stats.triangles,
		pipelines: stats.pipelines,
	};
});
