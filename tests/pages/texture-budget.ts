// Starts the engine live with textures past a small texture memory budget, and captures the frame
// once they fit under it, with the largest levels of the two large textures dropped. Then the
// sketch raises the budget, so those levels load again from their file, and drops a level of a
// compressed texture, which loads again from its KTX2 file. Besides the image, the page reports
// whether each phase did what the budget promises.
import { createEngine } from '@null3d/engine';
import { progress, run, toBase64 } from './lib/result';

/** What a phase of the sketch measured. */
interface Figures {
	bytes: number;
	budgetBytes: number;
	droppedLevels: number;
	droppedTextures: number;
	left: number;
	right: number;
	small: number;
	leftBytes: number;
	leftWidth: number;
	smallBytes: number;
	changes?: number;
}

interface Result {
	loaded: Figures;
	dropped: Figures;
	restored: Figures;
	least: Figures;
	compressed: { format: string; bytes: number; dropped: number; droppedBytes: number };
}

run('texture-budget', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/texture-budget-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	progress('engine started');
	let capture: Awaited<ReturnType<typeof engine.captureFrame>> | undefined;
	const result = await new Promise<Result>((resolve, reject) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'dropped') {
				progress(`levels dropped: ${JSON.stringify(data)}`);
				engine.captureFrame().then((frame) => {
					capture = frame;
					progress('frame captured');
					engine.postToSketch('next');
				}, reject);
			} else if (name === 'result') resolve(data as Result);
			else if (name === 'error') reject(new Error(String(data)));
		}),
	);
	progress(`every phase done: ${JSON.stringify(result)}`);
	const { mode, capabilities } = engine;
	await engine.destroy();
	if (!capture) throw new Error('the sketch finished without the frame of dropped levels');
	const { loaded, dropped, restored, least, compressed } = result;
	return {
		tier: capabilities.tier,
		mode,
		result,
		// The textures fit under the budget, which the quality report gives.
		withinBudget: dropped.bytes <= dropped.budgetBytes && dropped.budgetBytes === 1024 * 1024,
		// Both large textures lost their largest level and keep their own size, and the change
		// handlers heard of it.
		largestDropped:
			dropped.left >= 1 &&
			dropped.right >= 1 &&
			dropped.leftWidth === 512 &&
			dropped.leftBytes < loaded.leftBytes / 3 &&
			(dropped.changes ?? 0) >= 1,
		// A texture too small to save memory keeps its levels at any budget.
		smallKept: dropped.small === 0 && least.small === 0,
		// Room returned, and the dropped levels loaded again from the file.
		restored: restored.droppedLevels === 0 && restored.leftBytes === loaded.leftBytes,
		// At the smallest budget, the large textures dropped as many levels as the budget drops.
		mostDropped: least.left === 3 && least.right === 3,
		// The compressed texture loaded again without its largest level.
		compressedDropped: compressed.dropped >= 1 && compressed.droppedBytes < compressed.bytes,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
