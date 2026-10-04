// Failures after the start, and engines that follow one another on one canvas. ?case= picks one:
// - fault: the engine's frame step throws once, and the page must hear E1404 while it stays
//   responsive.
// - job-fault: the test makes a job worker fail inside the job system (it rewrites the job
//   worker's script), and the page must hear E1404 while it stays responsive.
// - same-canvas: an engine starts, and is destroyed without a wait while a second one starts on the
//   same canvas, as React's StrictMode does. A third start follows at once. With &pattern=then, the first start is destroyed once
//   it resolves; with &pattern=abort, it is cancelled. The second must draw, with no more workers
//   than one engine has. Once the canvas leaves the page, no worker stays, and in the modes where a
//   worker drew, a later engine on the canvas fails with E1419.
// - two-live: a second engine on the canvas of a running one fails with E1419.
// - after-destroy: a sketch on the page's thread calls the engine after destroy(), and again once
//   a second engine runs: both calls fail with E1420.
import { createEngine, type Engine, type EngineError } from '@null3d/engine';
import { liveWorkers, progress, run } from './lib/result';
import type { FailuresSketch } from './sketches/failures-sketch';

const params = new URLSearchParams(location.search);
const sketch = new URL('./sketches/failures-sketch.ts', import.meta.url);
/** How long the page waits for a failure, and how often its own timer ticks meanwhile. */
const REPORT_MS = 15_000;
const TICK_MS = 50;

const canvas = document.querySelector('canvas') as HTMLCanvasElement;

/** Starts an engine on the page's canvas, and waits for its first frame. */
async function started(url = sketch, signal?: AbortSignal): Promise<Engine> {
	const engine = await createEngine({ canvas, sketch: url, signal });
	await engine.firstFrame;
	return engine;
}

/** The frames that an engine draws in half a second. */
async function framesOf(engine: Engine): Promise<number> {
	return (await engine.measure(0.5)).frames;
}

/**
 * Waits for the engine's first failure, while a timer on the page counts its ticks. A page whose
 * thread hangs counts none, and never publishes a result.
 */
async function firstFailure(engine: Engine): Promise<Record<string, unknown>> {
	const failures: EngineError[] = [];
	engine.onFailure((error) => failures.push(error));
	let ticks = 0;
	const timer = setInterval(() => ticks++, TICK_MS);
	const deadline = performance.now() + REPORT_MS;
	while (failures.length === 0 && performance.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, TICK_MS));
	// Later reports of the same failure, from the other threads it reached.
	await new Promise((resolve) => setTimeout(resolve, 500));
	clearInterval(timer);
	await engine.destroy();
	return {
		codes: failures.map((error) => error.code),
		messages: failures.map((error) => error.message.split(' See ')[0]),
		ticks,
	};
}

/** The code of a failed call, or 'none'. */
function codeOf(call: () => unknown): string {
	try {
		call();
		return 'none';
	} catch (error) {
		return (error as EngineError).code ?? String(error);
	}
}

run('failures', async () => {
	const which = params.get('case');
	if (which === 'fault') {
		const faulty = new URL(sketch);
		faulty.searchParams.set('fault', 'step');
		return firstFailure(await started(faulty));
	}
	if (which === 'job-fault') return firstFailure(await started());
	if (which === 'same-canvas') {
		const first = await started();
		const workersOfOne = liveWorkers();
		// Not waited for: the next start waits for it.
		void first.destroy();
		const pattern = params.get('pattern');
		if (pattern === 'abort') {
			const controller = new AbortController();
			const cancelled = started(sketch, controller.signal).catch((error) => String(error));
			controller.abort(new Error('cancelled by the cleanup'));
			await cancelled;
		} else {
			const destroyed = createEngine({ canvas, sketch }).then((engine) => engine.destroy());
			void destroyed;
		}
		const second = await started();
		progress('second engine started');
		const frames = await framesOf(second);
		const workersOfSecond = liveWorkers();
		await second.destroy();
		const workersAfter = liveWorkers();
		// A canvas that leaves the page takes the worker that kept it along.
		canvas.remove();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const workersAfterRemoval = liveWorkers();
		document.body.prepend(canvas);
		const reuse = await createEngine({ canvas, sketch }).then(
			(engine) => engine.destroy().then(() => 'started'),
			(error: EngineError) => error.code,
		);
		return { workersOfOne, workersOfSecond, frames, workersAfter, workersAfterRemoval, reuse };
	}
	if (which === 'two-live') {
		const first = await started();
		const code = await createEngine({ canvas, sketch }).then(
			() => 'started',
			(error: EngineError) => error.code,
		);
		const frames = await framesOf(first);
		await first.destroy();
		return { code, frames };
	}
	if (which === 'after-destroy') {
		const first = await started();
		const left = (globalThis as { __failuresSketch?: FailuresSketch }).__failuresSketch;
		if (!left) throw new Error('the sketch did not run on the page');
		await first.destroy();
		const box = () => left.context.geometry.box();
		const afterDestroy = codeOf(box);
		const second = await started();
		const whileAnotherRuns = codeOf(box);
		const frames = await framesOf(second);
		await second.destroy();
		return { afterDestroy, whileAnotherRuns, destroyed: left.destroyed, frames };
	}
	throw new Error(`unknown case ${which}`);
});
