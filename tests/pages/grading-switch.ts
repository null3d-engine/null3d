// Changes the grading controls' values while the scene plays: the sketch asks a job worker for a
// new table, and the frames keep drawing. The page measures play before a change, the frames that
// the change lands across, the frames just after it, and a run that changes a value in every frame.
// It reports each window's frame intervals, uploaded bytes, presented rate, skipped draws, GPU
// objects and pipelines, with the thread times of the sketch and the job workers.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { run } from './lib/result';

/** How long the steady measurements run. */
const SECONDS = 1;
/** How long the windows around one change run: enough frames for a percentile to hold a maximum. */
const CHANGE_SECONDS = 0.5;
/** How long the run that changes a value in every frame lasts. */
const EVERY_FRAME_SECONDS = 2;

/** One window's figures, as the page reports them. */
interface Window {
	frames: number;
	intervalMedian: number;
	intervalP99: number;
	uploadMean: number;
	presentedFps: number;
	skippedDraws: number;
	gpuObjects: number;
	pipelines: number;
	sketchMs: number;
}

/** One measurement's figures, named for what its window held. */
function figures(measured: FrameMetrics): Window {
	return {
		frames: measured.frames,
		intervalMedian: measured.intervalMs.median,
		intervalP99: measured.intervalMs.p99,
		uploadMean: measured.uploadBytes.mean,
		presentedFps: measured.presentedFps,
		skippedDraws: measured.skippedDraws,
		gpuObjects: measured.gpuObjects,
		pipelines: measured.pipelines,
		sketchMs: measured.threads['sketch-worker']?.busyMs.p95 ?? 0,
	};
}

/** The job workers' CPU time per frame, added over the threads that report it. */
const jobMs = (measured: FrameMetrics): number =>
	Object.entries(measured.threads).reduce(
		(total, [name, thread]) => (name.startsWith('job') ? total + thread.busyMs.p95 : total),
		0,
	);

run('grading-switch', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/grading-sketch.ts?grade', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const beforeRaw = await engine.measure(SECONDS);
	// One change: the window opens first, so the frame that lands the bake is one of its frames.
	const landing = engine.measure(CHANGE_SECONDS);
	engine.postToSketch('grade-step', null);
	const landedRaw = await landing;
	const nextRaw = await engine.measure(CHANGE_SECONDS);
	// A value that changes in every frame, as a slider drag does.
	const across = engine.measure(EVERY_FRAME_SECONDS);
	engine.postToSketch('grade', null);
	const duringRaw = await across;
	engine.postToSketch('grade-fixed', null);
	const afterRaw = await engine.measure(SECONDS);
	// The workers that the page started, so the result says whether a job worker took the bake.
	const workers = (window.__null3dProgress ?? [])
		.filter((step) => step.endsWith(': started'))
		.map((step) => step.replace(/^\d+ ms /, '').replace(': started', ''));
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		refreshHz: beforeRaw.refreshHz,
		workers,
		before: figures(beforeRaw),
		landed: figures(landedRaw),
		next: figures(nextRaw),
		during: figures(duringRaw),
		after: figures(afterRaw),
		jobBefore: jobMs(beforeRaw),
		jobDuring: jobMs(duringRaw),
		failures,
	};
});
