// Runs a frame with twelve passes and reads one texel of each after it drew, then reports the values
// so the test can check that every read answered with its own pass's colour rather than another
// view's buffer.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** What the sketch reports once the reads have landed. */
interface CrowdedReport {
	/** The red of one texel of each pass, in the order that the sketch added them. */
	values: number[];
	/** The frames between each read's request and its answer. */
	frames: number[];
}

run('crowded-read', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/crowded-read-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const tier = engine.capabilities.tier;
	const mode = engine.mode;
	const report = await new Promise<CrowdedReport>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error('the sketch reported no read within 60 s')),
			60_000,
		);
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'read') return;
			clearTimeout(timer);
			off();
			resolve(data as CrowdedReport);
		});
	});
	await engine.destroy();
	return { tier, mode, ...report };
});
