// Asks the engine for instance batches around its limits: one past the limit that every WebGPU
// device draws, one as large as the device's own limit, and a small one after both. Reports the device's
// limit, what each request returned, and how many pixels the large batch drew.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** Rows of the batch that passes the limit every WebGPU device draws. */
const PAST_PORTABLE = 3_000_000;

interface BatchResult {
	ok: boolean;
	code?: string;
	message?: string;
}

run('limits', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const replies = new Map<string, (data: unknown) => void>();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/limit-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		onSketchMessage: (name, data) => replies.get(name)?.(data),
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	const ask = <T>(name: string, reply: string, data?: unknown) =>
		new Promise<T>((resolve) => {
			replies.set(reply, resolve as (data: unknown) => void);
			engine.postToSketch(name, data);
		});
	const batch = (count: number) => ask<BatchResult>('batch', 'batch', count);
	const drawnPixels = async () => {
		await engine.measure(1);
		const { pixels } = await engine.captureFrame();
		let lit = 0;
		for (let i = 0; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 128) lit++;
		return lit;
	};

	await engine.firstFrame;
	const { maxInstances } = engine.capabilities;
	const pastPortable = await batch(PAST_PORTABLE);
	const pastPortableDrawn = pastPortable.ok ? await drawnPixels() : 0;
	if (pastPortable.ok) await ask('destroy', 'destroyed');
	// The scene's object slots count toward the limit, so this batch fills it exactly.
	const sceneSlots = 16_384;
	const full = await batch(maxInstances - sceneSlots);
	if (full.ok) await ask('destroy', 'destroyed');
	const after = await batch(1000);
	const afterDrawn = after.ok ? await drawnPixels() : 0;
	await engine.destroy();
	return {
		mode: engine.mode,
		maxInstances,
		pastPortable,
		pastPortableDrawn,
		full,
		after,
		afterDrawn,
		failures,
	};
});
