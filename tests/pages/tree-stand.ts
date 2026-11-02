// Times a stand of one review species as a scene draws it, through the engine's own measurement.
// ?species= names the review tree, ?count= the copies, ?fill= scales the filled crown, ?spacing=
// the grid step and ?seconds= the measured time. Opens no window and starts no server; a caller
// that already serves this checkout opens the page and reads its result.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const SECONDS = Number(params.get('seconds') ?? 5);

run('tree-stand', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/tree-stand-sketch.ts', import.meta.url);
	sketch.search = location.search;
	const failures: string[] = [];
	const engine = await createEngine({ canvas, sketch, stats: false });
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	await engine.firstFrame;
	progress('the first frame drew');
	const metrics = await engine.measure(SECONDS);
	await engine.destroy();
	if (!(metrics.presentedFps > 0))
		throw new Error(`the measure drew no frame in ${metrics.seconds.toFixed(1)} s`);
	return {
		species: params.get('species') ?? 'review-pine',
		count: Number(params.get('count') ?? 20),
		fill: Number(params.get('fill') ?? 1),
		spacing: Number(params.get('spacing') ?? 8),
		seconds: metrics.seconds,
		frames: metrics.frames,
		presentedFps: metrics.presentedFps,
		updatedFps: metrics.updatedFps,
		refreshHz: metrics.refreshHz,
		cpuMs: metrics.cpuMs,
		cpuMsAllThreads: metrics.cpuMsAllThreads,
		gpuMs: metrics.gpuMs,
		intervalMs: metrics.intervalMs,
		drawCalls: metrics.drawCalls,
		triangles: metrics.triangles,
		tier: engine.capabilities.tier,
		mode: { ...engine.mode },
		failures,
	};
});
