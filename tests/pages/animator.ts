// Starts the engine with the animator sketch and returns what its characters' handlers heard, once
// the sketch reports it.
import { createEngine } from '@null3d/engine';
import type { AnimatorReport } from './lib/animator-report';
import { run } from './lib/result';

run('animator', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	let resolveReport: (report: AnimatorReport) => void = () => {};
	const report = new Promise<AnimatorReport>((resolve) => {
		resolveReport = resolve;
	});
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/animator-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		onSketchMessage: (name, data) => {
			if (name === 'report') resolveReport(data as AnimatorReport);
		},
	});
	const result = await report;
	engine.destroy();
	return { mode: engine.mode, ...result };
});
