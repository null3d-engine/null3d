// Starts the engine with an empty sketch in the mode the URL's switches ask for, on the GPU that
// ?power prefers, and measures it for a few seconds. Then it reports the mode, the capabilities,
// the frame metrics, how many times the sketch updated, its largest step and the names of the
// messages it sent. With ?pause, it pauses and resumes the sketch before it asks.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '2');
/** How long `?pause` pauses the sketch. */
const PAUSE_MS = 600;

run('engine', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stages: string[] = [];
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
		onProgress: (stage) => stages.push(stage),
		powerPreference: (params.get('power') ?? undefined) as
			| 'high-performance'
			| 'low-power'
			| undefined,
	});
	await engine.firstFrame;
	const stats = await engine.measure(seconds);
	if (params.has('pause')) {
		// A pause the sketch must not see as one long step.
		engine.setPaused(true);
		await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
		engine.setPaused(false);
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	const messages: string[] = [];
	const count = await new Promise<unknown>((resolve) => {
		engine.onSketchMessage((name, data) => {
			messages.push(name);
			if (name === 'count') resolve(data);
		});
		engine.postToSketch('count');
	});
	const capture = params.has('capture') ? await engine.captureFrame() : undefined;
	engine.destroy();
	return {
		mode: engine.mode,
		capabilities: engine.capabilities,
		report: engine.report,
		stats,
		stages,
		messages,
		count,
		capture: capture && {
			width: capture.width,
			height: capture.height,
			pixels: toBase64(capture.pixels),
		},
	};
});
