// Measures the frames while meshes made in code plan their levels on the job workers. The page
// runs the sketch that ?sketch= names, from the repository's root, and measures the frame interval
// in one-second windows for ?seconds= seconds after the first frame. A frame that the plans made
// late shows as a window whose 99th percentile rises above the others. The sketch may post `made`
// and `levels` with the page's time, which the page reports beside the windows. Open it with
// ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const sketch = params.get('sketch') ?? '/tests/pages/sketches/levels-large-sketch.ts';
const seconds = Number(params.get('seconds') ?? '12');

run('levels-frames', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({ canvas, sketch: new URL(sketch, location.origin) });
	const events: { name: string; data: unknown; at: number }[] = [];
	engine.onSketchMessage((name, data) => events.push({ name, data, at: performance.now() }));
	await engine.firstFrame;
	const start = performance.now();
	const windows = [];
	for (let k = 0; k < seconds; k++) {
		const stats = await engine.measure(1);
		const busy: Record<string, number> = {};
		for (const [name, thread] of Object.entries(stats.threads))
			busy[name] = Math.round(thread.busyMs.p99 * 10) / 10;
		windows.push({
			from: Math.round(performance.now() - start - 1000),
			frames: stats.intervalMs.count,
			medianMs: Math.round(stats.intervalMs.median * 10) / 10,
			p99Ms: Math.round(stats.intervalMs.p99 * 10) / 10,
			busyP99Ms: busy,
		});
		progress(`window ${k}: p99 ${stats.intervalMs.p99.toFixed(1)} ms`);
	}
	const tier = engine.capabilities.tier;
	await engine.destroy();
	return {
		tier,
		windows,
		events: events.map((event) => ({ ...event, at: Math.round(event.at - start) })),
	};
});
