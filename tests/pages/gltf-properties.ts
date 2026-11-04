// Starts the engine with the property sketch and returns the value that its animator wrote to each
// property of a glTF file's clip at each sampled time, once the sketch reports them.
import { createEngine } from '@null3d/engine';
import type { PropertyReport } from './lib/gltf-properties';
import { run } from './lib/result';

run('gltf-properties', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	let resolveReport: (report: PropertyReport) => void = () => {};
	const report = new Promise<PropertyReport>((resolve) => {
		resolveReport = resolve;
	});
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/gltf-properties-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		onSketchMessage: (name, data) => {
			if (name === 'report') resolveReport(data as PropertyReport);
		},
	});
	const result = await report;
	engine.destroy();
	return { mode: engine.mode, ...result };
});
