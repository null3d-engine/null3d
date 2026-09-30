// Starts the engine in the anti-aliasing mode that ?from= names, with the edges scene of the
// anti-aliasing image tests. It captures a frame, then measures while the sketch changes to the mode
// that ?to= names, and captures again once the change has resolved. It then starts a second engine
// in the ?to= mode and captures its frame, which the changed engine must match. The page reports
// what the measurement counted, the sketch's answer, whether each engine drew HDR color, and how
// many pixels differ between the captures. The engine reads its own switches: ?gpu= the tier, and
// the thread mode's switches.
import { createEngine, type EngineOptions } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
/** How long the measurement runs, long enough to hold the whole change. */
const MEASURE_SECONDS = 1.5;

type Antialias = NonNullable<EngineOptions['antialias']>;

/** The pixels of two captures of the same size that differ by more than one step in a channel. */
function differing(a: Uint8Array, b: Uint8Array): number {
	let count = 0;
	for (let at = 0; at < a.length; at += 4)
		for (let c = 0; c < 3; c++)
			if (Math.abs((a[at + c] as number) - (b[at + c] as number)) > 1) {
				count++;
				break;
			}
	return count;
}

/** Starts an engine with the edges scene in an anti-aliasing mode, once its first frame is shown. */
async function start(canvas: HTMLCanvasElement, antialias: Antialias) {
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/antialias-change-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		antialias,
	});
	await engine.firstFrame;
	return engine;
}

run('antialias-change', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const from = (params.get('from') ?? 'msaa') as Antialias;
	const to = (params.get('to') ?? 'fxaa') as Antialias;
	const engine = await start(canvas, from);
	const hdrBefore = engine.capabilities.hdr;
	const before = await engine.captureFrame();
	const answered = new Promise<unknown>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'antialias-set') return;
			off();
			resolve(data);
		});
	});
	const measuring = engine.measure(MEASURE_SECONDS);
	engine.postToSketch('set-antialias', to);
	const sketch = await answered;
	const measured = await measuring;
	const after = await engine.captureFrame();
	const hdrAfter = engine.capabilities.hdr;
	await engine.destroy();

	// A canvas that another engine drew into cannot start a new one, so the fresh start draws
	// into a canvas of its own, which the page's style gives the same size.
	const fresh = document.createElement('canvas');
	canvas.after(fresh);
	const started = await start(fresh, to);
	const direct = await started.captureFrame();
	const hdrDirect = started.capabilities.hdr;
	await started.destroy();
	return {
		tier: engine.capabilities.tier,
		sketch,
		hdr: { before: hdrBefore, after: hdrAfter, direct: hdrDirect },
		skippedDraws: measured.skippedDraws,
		pipelines: measured.pipelines,
		frames: measured.frames,
		pixels: before.pixels.length / 4,
		changedPixels: differing(before.pixels, after.pixels),
		differFromDirect: differing(after.pixels, direct.pixels),
	};
});
