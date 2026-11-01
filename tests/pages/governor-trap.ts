// The governor's trap page (lib/governor-trap.ts): it tunes the canvas to a size where the whole
// scale's frames miss the target rate but stay well under half a second, then turns the governor
// on. On a software renderer the first step below the whole scale turns on the two-step upscale,
// which costs more than the smaller scene saves, so the frames come slower, and the page reports
// each render scale change. On a software renderer the governor takes that step back and keeps the
// whole scale after it (D-237).
import { createEngine, type Engine } from '@null3d/engine';
import { TRAP, type TrapResult, type TrapState } from './lib/governor-trap';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);

/** How long the page waits between two looks at the sketch's states, in ms. */
const POLL_MS = 100;

/** Resolves after `seconds`. */
const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** The canvas's size changes, and the frames of the new size settle before the page measures. */
async function resize(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	await wait(TRAP.settleSeconds);
}

run('governor-trap', async (): Promise<TrapResult> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const states: TrapState[] = [];
	let from = performance.now();
	const sketch = new URL('./sketches/governor-trap-sketch.ts', import.meta.url);
	const engine: Engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	engine.onSketchMessage((name, data) => {
		if (name !== 'governor-scale') return;
		const change = data as { renderScale: number; frame: number };
		states.push({
			at: (performance.now() - from) / 1000,
			renderScale: change.renderScale,
			frame: change.frame,
		});
		progress(
			`scale ${change.renderScale} after ${((performance.now() - from) / 1000).toFixed(2)} s`,
		);
	});
	await engine.firstFrame;

	/** Draws a measurement of the whole scale's frames, and reads their rate and frame time. */
	const measure = async (): Promise<{ fps: number; frameMs: number; refreshHz: number | null }> => {
		const stats = await engine.measure(TRAP.measureSeconds);
		return {
			fps: stats.presentedFps,
			frameMs: stats.presentedFps > 0 ? 1000 / stats.presentedFps : Number.POSITIVE_INFINITY,
			refreshHz: stats.refreshHz,
		};
	};

	// Tune the canvas: the frame time follows the pixels, so the side follows its square root. A
	// few tries land in the band on a software renderer of any speed.
	let side = Number(TRAP.first[0]);
	let whole = { fps: 0, frameMs: Number.POSITIVE_INFINITY, refreshHz: null as number | null };
	for (let tries = 0; tries < 6; tries++) {
		await resize(canvas, side, Math.round((side * 9) / 16));
		whole = await measure();
		progress(`canvas ${side}, ${whole.fps.toFixed(1)} fps`);
		if (whole.frameMs >= TRAP.quickestMs && whole.frameMs <= TRAP.slowestMs) break;
		const wanted = whole.frameMs < TRAP.quickestMs ? TRAP.quickestMs : TRAP.slowestMs;
		const factor = Math.min(2, Math.max(0.5, Math.sqrt(wanted / whole.frameMs)));
		side = Math.min(TRAP.largestSide, Math.max(TRAP.smallestSide, Math.round(side * factor)));
	}
	const size = { width: canvas.width, height: canvas.height };
	const targetHz = Math.min(
		whole.refreshHz ?? TRAP.maxTargetHz,
		TRAP.maxTargetHz,
		params.has('fps') ? Number(params.get('fps')) : Number.POSITIVE_INFINITY,
	);

	/** Resolves with true once `done` holds, or with false after `seconds`. */
	const waitFor = async (done: () => boolean, seconds: number): Promise<boolean> => {
		const end = performance.now() + seconds * 1000;
		while (!done()) {
			if (performance.now() >= end) return false;
			await wait(POLL_MS / 1000);
		}
		return true;
	};

	// The governor's clock starts again when it comes on, with its grace.
	const tier = engine.capabilities.tier;
	states.length = 0;
	from = performance.now();
	engine.postToSketch('governor', true);
	await waitFor(
		() => states.some((state) => state.renderScale === TRAP.minScale),
		TRAP.stepSeconds,
	);
	const atStep = states.findIndex((state) => state.renderScale === TRAP.minScale);
	await waitFor(
		() => states.slice(atStep + 1).some((state) => state.renderScale === 1),
		TRAP.returnSeconds,
	);
	const atReturn = states.findIndex((state, k) => k > atStep && state.renderScale === 1);
	// A software renderer takes no step below the whole scale again, however long the page runs.
	await wait(TRAP.watchSeconds);
	const laterSteps = atReturn < 0 ? 0 : states.slice(atReturn + 1).length;
	const step = atStep >= 0 ? states[atStep] : undefined;
	const back = atReturn >= 0 ? states[atReturn] : undefined;
	await engine.destroy();
	return {
		tier,
		canvas: size,
		wholeFps: whole.fps,
		wholeFrameMs: Number.isFinite(whole.frameMs) ? whole.frameMs : -1,
		targetHz,
		states,
		steppedAt: step?.at ?? null,
		returnedAt: back?.at ?? null,
		laterSteps,
		failures,
	};
});
