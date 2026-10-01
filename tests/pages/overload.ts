// The GPU-bound page. It starts the engine on the GPU path that ?gpu= asks for, with a scene whose
// GPU work it sets, and doubles that work step by step, measuring each step for a second. At the
// first step where the lower of the presented and completed rates falls below half the display's
// rate, as the lightest step measured it, the page measures longer and stops. It reports each
// step's presented rate, completed rate, time from submit to completion and GPU time, so a run
// shows whether frames queue on the GPU when the GPU cannot keep up. With ?spheres=<n>, it
// measures that many spheres alone, so runs with different switches compare at one load.
// `lib/overload.ts` holds the scene and the steps.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import {
	OVERLOAD_SPHERES,
	OVERLOAD_STEPS,
	type OverloadResult,
	type OverloadStep,
} from './lib/overload';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? OVERLOAD_STEPS.seconds);
const fixedCount = params.has('spheres') ? Number(params.get('spheres')) : undefined;

function stepOf(count: number, stats: FrameMetrics): OverloadStep {
	return {
		count,
		presentedFps: stats.presentedFps,
		completedFps: stats.completedFps,
		gpuLatencyMs: stats.gpuLatencyMs && {
			median: stats.gpuLatencyMs.median,
			p95: stats.gpuLatencyMs.p95,
		},
		gpuMs: stats.gpuMs?.median ?? null,
		cpuMs: stats.cpuMs.median,
		refreshHz: stats.refreshHz,
		raw: (stats as unknown as { debugRaw: unknown }).debugRaw,
	} as OverloadStep;
}

run('overload', async (): Promise<OverloadResult> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/overload-sketch.ts', import.meta.url),
	});
	let loaded: (() => void) | undefined;
	engine.onSketchMessage((name) => {
		if (name === 'load') loaded?.();
	});
	const load = (count: number) =>
		new Promise<void>((resolve) => {
			loaded = resolve;
			engine.postToSketch('load', count);
		});
	await engine.firstFrame;
	const steps: OverloadStep[] = [];
	let overloaded: OverloadStep | null = null;
	let displayHz: number | null = null;
	let completionSignal = '';
	const first = fixedCount ?? OVERLOAD_STEPS.firstCount;
	for (let count = first; count <= OVERLOAD_SPHERES; count *= 2) {
		await load(count);
		const stats = await engine.measure(OVERLOAD_STEPS.stepSeconds);
		const step = stepOf(count, stats);
		steps.push(step);
		displayHz ??= stats.refreshHz;
		completionSignal = stats.completionSignal;
		progress(
			`${count} spheres: presented ${step.presentedFps.toFixed(1)}, completed ${step.completedFps?.toFixed(1)}`,
		);
		const lower = Math.min(step.presentedFps, step.completedFps ?? 0);
		if (fixedCount || (displayHz && lower < displayHz * OVERLOAD_STEPS.overloadedShare)) {
			overloaded = stepOf(count, await engine.measure(seconds));
			break;
		}
	}
	const tier = engine.capabilities.tier;
	await engine.destroy();
	return { tier, displayHz, completionSignal, steps, overloaded };
});
