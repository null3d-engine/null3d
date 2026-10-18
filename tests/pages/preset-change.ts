// Starts the engine at the preset that the engine's ?preset= switch names, Medium without it, with a
// row of boxes whose pipeline the first frame builds. The switch, unlike the page's option, keeps the
// engine's crash marker from lowering the start: a note that an earlier page left would otherwise
// start a lighter preset. The page captures a frame, then measures while the sketch switches to the
// preset that ?to= names, and captures again once the switch has resolved. The sketch draws the boxes with a new
// pipeline at the new preset, as start-time settings change pipelines. With ?swap, the sketch
// changes the pipeline without a preset change instead. The page reports the preset that the engine
// started at, what the measurement counted and, for each capture, the share of its pixels that
// differ from the background.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
/**
 * How long the measurement runs, long enough to hold the whole switch. A software GPU on a slow
 * runner needs several seconds to apply a preset and build its pipelines, and the frames that the
 * build stalls must fit in the window for its count to be recorded.
 */
const MEASURE_SECONDS = 8;

/** The share of the pixels that differ from the frame's first pixel, the background. */
function covered({ pixels }: { pixels: Uint8Array }): number {
	let differ = 0;
	for (let at = 0; at < pixels.length; at += 4)
		if (pixels[at] !== pixels[0] || pixels[at + 1] !== pixels[1] || pixels[at + 2] !== pixels[2])
			differ++;
	return differ / (pixels.length / 4);
}

run('preset-change', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/preset-change-sketch.ts', import.meta.url),
		preset: (params.get('preset') ?? 'medium') as QualityPreset,
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const started = engine.mode.preset;
	const before = await engine.captureFrame();
	const answered = new Promise<unknown>((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'preset-set') return;
			off();
			resolve(data);
		});
	});
	// A measurement's window opens at the call, so its first use holds the few frames that the frame
	// figures' download takes. A short measurement downloads them first, which keeps them out of the
	// window that holds the switch.
	await engine.measure(0.01);
	const measuring = engine.measure(MEASURE_SECONDS);
	const swap = params.has('swap');
	if (swap) engine.postToSketch('swap');
	else engine.postToSketch('set-preset', params.get('to') ?? 'low');
	const sketch = swap ? undefined : await answered;
	const mode = { ...engine.mode };
	const measured = await measuring;
	const after = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		started,
		mode,
		sketch,
		skippedDraws: measured.skippedDraws,
		pipelines: measured.pipelines,
		lostRecords: measured.lostRecords,
		frames: measured.frames,
		coveredBefore: covered(before),
		coveredAfter: covered(after),
		changed: before.pixels.some((value, at) => after.pixels[at] !== value),
	};
});
