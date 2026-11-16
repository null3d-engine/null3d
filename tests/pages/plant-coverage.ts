// The page that draws the coverage row and publishes its frame with the crown boxes, which the
// plant coverage test reads. The page's own switches turn a proving control: a sparse grow or a
// card cutoff that leaves holes, and the manifest test draws with neither.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { type CoverageFacts, FRAME, measureCoverage } from './lib/plant-coverage';
import { progress, run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);

run('plant-coverage', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/plant-coverage-sketch.ts', import.meta.url);
	// The proving controls reach the sketch's own address, and the sketch reports what it read.
	for (const name of ['sparse', 'cardCutoff']) {
		const value = params.get(name);
		if (value !== null) sketch.searchParams.set(name, value);
	}
	// Vite takes a module's language from the last dot of its address, so a switch that ends in a
	// decimal would make the sketch JavaScript. The extension marker goes last.
	if (sketch.search) sketch.search += '&lang.ts';
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'high') as QualityPreset,
	});
	const facts = await new Promise<CoverageFacts>((resolve, reject) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'plant-coverage') resolve(data as CoverageFacts);
		});
		setTimeout(() => reject(new Error('the sketch posted no crown boxes')), 150_000);
	});
	await engine.firstFrame;
	progress(`the first frame drew with crowns at ${facts.distances.join(', ')} m`);
	const frame = await engine.captureFrame();
	await engine.destroy();
	if (frame.width !== FRAME.width || frame.height !== FRAME.height)
		throw new Error(
			`the picture is ${frame.width} by ${frame.height}, not ${FRAME.width} by ${FRAME.height}`,
		);
	return {
		tier: engine.capabilities.tier,
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
		distances: facts.distances,
		levels: facts.levels,
		boxes: facts.boxes,
		shares: measureCoverage(frame.pixels, frame.width, frame.height, facts.boxes),
	};
});
