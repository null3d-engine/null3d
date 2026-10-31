// Starts the engine with the emitter comparison's sketch and waits for its check: the core's
// emitter must write exactly the records that the reference emitter in TypeScript writes, for
// several seeds, every shape, a followed emitter, sub-emitter chains and a ring that wraps.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** What one difference between the two paths is. */
interface Mismatch {
	scenario: string;
	record: number;
	field: number;
	reference: number;
	core: number;
}

/** What the sketch's check reports. */
interface Checked {
	scenarios: number;
	records: number;
	mismatches: Mismatch[];
	error?: string;
}

run('particle-emit', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/particle-emit-sketch.ts', import.meta.url),
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
		}, 300_000);
	});
	await engine.destroy();
	return { tier: engine.capabilities.tier, ...checked };
});
