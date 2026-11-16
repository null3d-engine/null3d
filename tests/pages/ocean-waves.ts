// Runs the ocean add-on's wave transform on the GPU tier that the URL's switches ask for, and
// reports the heights that its transform wrote and the heights that the same spectra give on this
// thread. The test compares the two, so a chain that loses a stage, reads the wrong row or turns the
// tile over shows.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** What the sketch reports once its reads have landed. */
interface WavesReport {
	/** The sketch time of the frame that asked for the heights. */
	time: number;
	/** The sketch time that each band's heights belong to, as the pass wrote it. */
	stamps: number[];
	/** Each band's texels read back: a row of four for each of four rows, from the stored first row. */
	gpu: number[][];
	/** The same places' heights on this thread, per band, in the same order. */
	cpu: number[][];
	/** The frames between each read's request and its answer. */
	frames: number[];
	/** A second read, later, which shows whether the sea moves between the two. */
	later: { time: number; gpu: number[][]; stamps: number[] };
	/** The meters that each band's tile covers. */
	tiles: number[];
	/** The grid's texels across each way. */
	grid: number;
	error?: string;
}

run('ocean-waves', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/ocean-waves-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const tier = engine.capabilities.tier;
	const mode = engine.mode;
	const report = await new Promise<WavesReport>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error('the sketch reported no waves within 60 s')),
			60_000,
		);
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'waves') return;
			clearTimeout(timer);
			off();
			resolve(data as WavesReport);
		});
	});
	await engine.destroy();
	return { tier, mode, ...report };
});
