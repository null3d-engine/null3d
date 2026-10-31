// What a far-tree impostor bake costs on this device, at each preset's atlas grid: the sketch of
// tests/pages/sketches/impostor-bake-sketch.ts bakes a conifer, a birch and an oak into both
// atlases at every grid, and reports each bake's time on the sketch thread and the bytes that its
// atlases hold. The bake runs on the CPU, so one run gives every GPU path the same figures. It
// fails when the sketch reported an error or gave no time.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** What a bake reports: its preset, its plant, the grid, the time and the atlases' bytes. */
interface BakeRun {
	preset: string;
	species: string;
	views: number;
	columns: number;
	rows: number;
	ms: number;
	bytes: number;
	triangles: number;
}

run('impostor-bake', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/impostor-bake-sketch.ts', import.meta.url);
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const baked = new Promise<BakeRun[]>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'baked') return;
			off();
			resolve(data as BakeRun[]);
		});
	});
	const started = performance.now();
	engine.postToSketch('bake', null);
	const runs = await baked;
	const elapsedMs = performance.now() - started;
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		devicePixelRatio,
		elapsedMs,
		runs,
		failures,
	};
});
