// Measures what levels of detail save on this device: a forest of ?count= pines, 40,000 by
// default, each with four levels, under the sun's shadows (tests/pages/sketches/lod-cost-sketch.ts;
// ?shadows=off casts none). After a warm-up, the page measures play with every tree at its base
// mesh, and with each tree at the level that its size on the screen picks, in turns, three times
// each. It reports the medians of each side's GPU time per frame, where the device has a GPU timer,
// and of its frame interval and CPU time, with each thread's. It then reports each side's memory,
// so the copy lists that the level buckets take show beside the frame time. Open it with ?gpu= for
// each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { overlayMemory, waitForOverlay } from './lib/overlay-figures';
import { run } from './lib/result';
import type { SideMemory } from './lib/side-memory';

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? '40000');
const shadows = params.get('shadows') ?? 'on';

run('lod-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/lod-cost-sketch.ts', import.meta.url);
	sketch.search = `?count=${count}&shadows=${shadows}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				off();
				resolve();
			});
		});
	const { off, on } = await featureCost(engine, async (levels) => {
		const built = settled();
		engine.postToSketch(levels ? 'levels' : 'levels-off', null);
		await built;
	});
	// The memory figures come from the overlay, which samples the GPUs' tables and the wasm file.
	// It shows after the timing, so its sampling costs none of the frames above. With levels the
	// copy lists take one copy per source, not one per level. The two sides' buffer figures are
	// identical, but that does not prove the sizing: the removed rule would give the same sides
	// too, and D-137 gives the absolute totals that rule it out.
	const wasmBytes = (await engine.measure(0.5)).memory.wasmBytes;
	const memory: { off?: SideMemory; on?: SideMemory } = {};
	for (const side of ['off', 'on'] as const) {
		const built = settled();
		engine.postToSketch(side === 'on' ? 'levels' : 'levels-off', null);
		await built;
		engine.stats(true);
		const ready = await waitForOverlay('triangles');
		memory[side] = { ready, ...overlayMemory(wasmBytes) };
		engine.stats(false);
	}
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		count,
		shadows,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		memory,
		failures,
	};
});
