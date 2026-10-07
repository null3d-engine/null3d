// Draws the flights of the large-world jitter check (lib/jitter.ts) and publishes their figures.
// Each flight starts an engine in large-world mode with the jitter sketch, moves the camera one step
// at a time through the sketch's messages, and reads each frame back. The engine runs live, but
// nothing in the scene moves between the camera's steps, so each frame read back shows one step.
// The engine reads its own switches, such as ?gpu=. With ?images, the page also captures PNG files
// of each flight's first and last frames, and publishes them in base64.
import { createEngine, type Engine } from '@null3d/engine';
import {
	FLIGHTS,
	type Flight,
	flightFigures,
	flightQuery,
	JITTER_SIZE,
	JITTER_STEPS,
	type Spot,
	spots,
} from './lib/jitter';
import { progress, run, toBase64 } from './lib/result';

const SKETCH = '/tests/pages/sketches/jitter-sketch.ts';
/** How long the sketch may take to settle the camera at a step, in ms. */
const STEP_TIMEOUT_MS = 10_000;
const withImages = new URLSearchParams(location.search).has('images');

/** Resolves once the sketch says that the camera stands at `step`. */
function placed(engine: Engine, step: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stop();
			reject(new Error(`the sketch did not place the camera at step ${step}`));
		}, STEP_TIMEOUT_MS);
		const stop = engine.onSketchMessage((name, data) => {
			if (name !== 'placed' || data !== step) return;
			clearTimeout(timer);
			stop();
			resolve();
		});
		engine.postToSketch('step', step);
	});
}

/**
 * Flies one flight, and returns the GPU path and the objects' spots in each frame, with PNG files
 * when asked.
 */
async function fly(
	flight: Flight,
	images: Record<string, string>,
): Promise<{ tier: string; frames: Spot[][] }> {
	progress(`flight ${flight.name}`);
	// A canvas that an engine drew on belongs to that engine's worker, so each engine gets its own.
	document.querySelector('canvas')?.remove();
	const canvas = document.createElement('canvas');
	canvas.style.width = `${JITTER_SIZE.width}px`;
	canvas.style.height = `${JITTER_SIZE.height}px`;
	document.body.prepend(canvas);
	const engine = await createEngine({
		canvas,
		sketch: new URL(`${SKETCH}?${flightQuery(flight)}`, location.origin),
		maxPixelRatio: 1,
		preset: 'medium',
		antialias: 'msaa',
		largeWorld: true,
	});
	try {
		const frames: Spot[][] = [];
		for (let step = 0; step < JITTER_STEPS; step++) {
			await placed(engine, step);
			const { width, height, pixels } = await engine.captureFrame();
			if (width !== JITTER_SIZE.width || height !== JITTER_SIZE.height)
				throw new Error(`the frame is ${width} x ${height}, not the check's size`);
			frames.push(spots(pixels, width, height));
			if (withImages && (step === 0 || step === JITTER_STEPS - 1))
				images[`${flight.name}-${step === 0 ? 'first' : 'last'}`] = toBase64(
					new Uint8Array(await (await engine.capture()).arrayBuffer()),
				);
		}
		return { tier: engine.capabilities.tier, frames };
	} finally {
		await engine.destroy();
	}
}

run('jitter', async () => {
	const images: Record<string, string> = {};
	const flown: Spot[][][] = [];
	let tier = '';
	for (const flight of FLIGHTS) {
		const flew = await fly(flight, images);
		tier = flew.tier;
		flown.push(flew.frames);
	}
	const origin = flown[0] as Spot[][];
	return {
		tier,
		...JITTER_SIZE,
		flights: FLIGHTS.map((flight, k) => flightFigures(flight, flown[k] as Spot[][], origin)),
		...(withImages && { images }),
	};
});
