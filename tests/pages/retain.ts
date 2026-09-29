// Keeps an engine across a change of view, as a single-page app does: it detaches the canvas,
// waits, attaches it to another element, then measures and captures. Reports the sketch's frame
// numbers around each step, where the canvas ended up, and whether a removed handler still heard.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** How long the canvas stays off the page, and how long the engine draws after it returns. */
const WAIT_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

run('retain', async () => {
	const first = document.getElementById('first');
	const second = document.getElementById('second');
	const canvas = first?.querySelector('canvas');
	if (!first || !second || !canvas) throw new Error('the page is missing its elements');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/boxes-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	const frame = () =>
		new Promise<number>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'frame') return;
				off();
				resolve(data as number);
			});
			engine.postToSketch('frame');
		});

	await engine.firstFrame;
	await sleep(WAIT_MS);
	const beforeDetach = await frame();
	engine.detach();
	const onPageWhileDetached = canvas.isConnected;
	const atDetach = await frame();
	await sleep(WAIT_MS);
	const afterWait = await frame();
	engine.attach(second);
	const inSecond = canvas.parentElement === second;
	await sleep(WAIT_MS);
	const afterAttach = await frame();
	const stats = await engine.measure(0.5);
	const capture = await engine.captureFrame();

	let removedHeard = 0;
	engine.onSketchMessage(() => removedHeard++)();
	await frame();
	await engine.destroy();
	return {
		mode: engine.mode,
		beforeDetach,
		onPageWhileDetached,
		atDetach,
		afterWait,
		inSecond,
		afterAttach,
		rebuilds: stats.rebuilds,
		pipelines: stats.pipelines,
		removedHeard,
		failures,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
