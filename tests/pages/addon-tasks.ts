// Runs the add-on task sketch, which sorts on the job workers through the task-probe add-on's
// public task, and reads the drawn frame back. It reports each round's queue frame, the frame that
// draws its answer, and the worker that ran the task, then finds the marker in the last frame.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

/** A round that the sketch reported. */
interface Round {
	round: number;
	/** The frame that queued the task. */
	queued: number;
	/** The first frame that can draw the answer. */
	applied: number;
	/** The browser's name of the worker that ran the task. */
	worker: string;
	order: number[];
}

/** A run of bright pixels in the middle row of the drawn frame. */
interface Run {
	start: number;
	end: number;
	centre: number;
}

/** The runs of bright pixels in the middle row of a frame. */
function brightRuns(pixels: Uint8Array, width: number, height: number): Run[] {
	const row = Math.floor(height / 2);
	const runs: Run[] = [];
	let start = -1;
	for (let x = 0; x <= width; x++) {
		const k = (row * width + x) * 4;
		const bright =
			x < width &&
			(pixels[k] as number) > 200 &&
			(pixels[k + 1] as number) > 200 &&
			(pixels[k + 2] as number) > 200;
		if (bright && start < 0) start = x;
		if (!bright && start >= 0) {
			runs.push({ start, end: x - 1, centre: (start + x - 1) / 2 });
			start = -1;
		}
	}
	return runs;
}

run('addon-tasks', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/addon-task-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		preset: 'low',
	});
	await engine.firstFrame;
	const rounds: Round[] = [];
	const outcome = await new Promise<{ failed?: string; rounds?: number }>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'round') {
				const round = data as Round;
				rounds.push(round);
				progress(`round ${round.round} queued in frame ${round.queued}, drawn in ${round.applied}`);
			} else if (name === 'failed') resolve(data as { failed: string });
			else if (name === 'done') resolve(data as { rounds: number });
		});
	});
	if (outcome.failed) throw new Error(outcome.failed);
	// The answer arrives between frames, and the frame that draws its marker may come later than a
	// fixed wait allows on a slow machine. Wait for a frame that the sketch computed after the answer
	// and the renderer drew, which carries the marker's move, then read the picture.
	const until = performance.now() + 30_000;
	let frames = 0;
	while (frames === 0 && performance.now() < until) frames = (await engine.measure(0.1)).frames;
	const { width, height, pixels } = await engine.captureFrame();
	progress(`captured ${width} by ${height}`);
	const mode = engine.mode;
	const tier = engine.capabilities.tier;
	await engine.destroy();
	return {
		tier,
		mode,
		rounds,
		bright: brightRuns(pixels, width, height),
		width,
		height,
	};
});
