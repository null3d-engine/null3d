// Starts the engine with the record-writer test's sketch and waits for its check: the block writer
// gives the records that the single write gives, a batch wraps around the buffer, and a shift moves
// the birth times that the time base leaves behind.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** What the sketch's check reports. */
interface Checked {
	single: number[];
	throughBlock: number[];
	equal: boolean;
	wrapped: number[];
	wrappedSeeds: number[];
	shifted: number;
	error?: string;
}

run('particle-writes', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/particle-writes-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const checked = await new Promise<Checked>((resolve, reject) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'checked') return;
			off();
			resolve(data as Checked);
		});
		engine.postToSketch('check');
		setTimeout(() => {
			off();
			reject(new Error('the sketch posted no check'));
		}, 60_000);
	});
	await engine.destroy();
	return { tier: engine.capabilities.tier, ...checked };
});
