// Runs the replace texture memory sketch and reads the engine's memory at each of its checkpoints,
// while the sketch waits. The engine's WebAssembly memory comes from a measurement; the GPU texture
// bytes, which include the textures that a replacement retired, come from the metrics buffer, so
// the stats overlay stays on and publishes them. Reports what each checkpoint found, and the
// failures that the engine heard.
import { createEngine } from '@null3d/engine';
import { MemoryFigure, memoryFigures } from '../../packages/engine/src/shared/metrics';
import { progress, run } from './lib/result';

interface Checkpoint {
	round: number;
	meshBytes: number;
	textureBytes: number;
	wasmBytes?: number | null;
	gpuTextureBytes?: number | null;
}

run('replace-texture-memory', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/replace-texture-memory-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		preset: 'low',
		// The overlaid figures are what publishes the GPU bytes that the backend holds.
		stats: true,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const checkpoints: Checkpoint[] = [];
	const done = await new Promise<{ moved?: number; rounds?: number; error?: string }>((resolve) =>
		engine.onSketchMessage(async (name, data) => {
			if (name === 'done') resolve(data as { moved?: number; rounds?: number; error?: string });
			if (name !== 'checkpoint') return;
			const checkpoint = data as Checkpoint;
			progress(`checkpoint after round ${checkpoint.round}`);
			const stats = await engine.measure(0.1);
			const buffer = (globalThis as { __null3dMetrics?: ArrayBufferLike }).__null3dMetrics;
			const figures = buffer === undefined ? undefined : memoryFigures(buffer);
			checkpoints.push({
				...checkpoint,
				wasmBytes: stats.memory.wasmBytes,
				gpuTextureBytes: figures?.[MemoryFigure.GpuTextureBytes] ?? null,
			});
			engine.postToSketch('go');
		}),
	);
	const mode = engine.mode;
	await engine.destroy();
	return { mode, done, checkpoints, failures };
});
