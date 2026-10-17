// Runs the destroy memory sketch and reads the engine's WebAssembly memory at each of its
// checkpoints, while the sketch waits. Reports what each checkpoint found, and the failures that
// the engine heard.
//
// The preset is fixed, as the engine's other measurement pages fix it. An engine that chooses its
// own preset starts on a heavier one and runs the preset check, which lowers it a moment after the
// setup. Its memory climbs into the heavier preset's room, and the heap never gives a page back, so
// the engine settles at the larger of the two presets' sizes. How long that settling takes follows
// how fast the machine draws, so on a slow machine it can still be going when the first checkpoint
// comes, and the memory then reads larger at the last one. This page measures what loading and
// destroying models costs, so it takes the engine that does not reconfigure itself partway through.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

interface Checkpoint {
	round: number;
	meshBytes: number;
	textureBytes: number;
	wasmBytes?: number | null;
}

run('destroy-memory', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/destroy-memory-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		preset: 'low',
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const checkpoints: Checkpoint[] = [];
	const done = await new Promise<{ hits?: number; error?: string }>((resolve) =>
		engine.onSketchMessage(async (name, data) => {
			if (name === 'done') resolve(data as { hits?: number; error?: string });
			if (name !== 'checkpoint') return;
			const checkpoint = data as Checkpoint;
			progress(`checkpoint after round ${checkpoint.round}`);
			const stats = await engine.measure(0.1);
			checkpoints.push({ ...checkpoint, wasmBytes: stats.memory.wasmBytes });
			engine.postToSketch('go');
		}),
	);
	const mode = engine.mode;
	await engine.destroy();
	return { mode, done, checkpoints, failures };
});
