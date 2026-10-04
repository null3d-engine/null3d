// GPU occlusion culling against culling without it, in the room scene (bench/scenes/room.ts): a
// room whose walls, its occluders, hide most of a field of detailed spheres. The page starts the
// engine without occlusion culling, then with it, at the High preset, and turns the camera through
// the scene's views in the same order on both. Each turn faces another wall, so the objects that
// drew in the frame before are not the ones in view. After each turn it reads a frame back, and
// counts the pixels where the two engines' frames differ. A frame read back draws the newest frame
// again, so it also checks that drawing with an up-to-date history changes nothing.
//
// With ?seconds=, the page then measures play in view 0, facing a doorway, for that many seconds on
// each side, ?rounds= times in turns, and reports the medians of each side's GPU time per frame,
// where the device has a GPU timer, and of its frame interval and CPU time, beside the share of the
// spheres that the walls hide. The device runner's occlusion plan runs it that way.
import { createEngine, type Engine } from '@null3d/engine';
import { hiddenShare, ROOM_VIEWS } from '../../bench/scenes/room';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const SECONDS = Number(params.get('seconds') ?? '0');
const ROUNDS = Number(params.get('rounds') ?? '3');
/** Segments around each sphere of the scene, from ?segments=. */
const SEGMENTS = Number(params.get('segments') ?? '32');
/** The anti-aliasing mode from ?antialias=, or the preset's. */
const ANTIALIAS = (['msaa', 'fxaa', 'none'] as const).find(
	(mode) => mode === params.get('antialias'),
);
/** Milliseconds to wait after a turn before reading a frame back. */
const TURN_SETTLE_MS = 250;
/** Seconds of play before the first measurement of each engine. */
const WARM_UP_SECONDS = 1;

/** The middle of some numbers, or null without any. */
function median(values: number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Starts an engine on a new canvas, with or without occlusion culling. */
async function start(gpuOcclusion: boolean): Promise<Engine> {
	document.querySelector('canvas')?.remove();
	const canvas = document.createElement('canvas');
	canvas.style.width = params.has('seconds') ? '100vw' : '320px';
	canvas.style.height = params.has('seconds') ? '100vh' : '180px';
	document.body.prepend(canvas);
	const sketch = new URL('./sketches/room-sketch.ts', import.meta.url);
	sketch.search = `?segments=${SEGMENTS}`;
	const engine = await createEngine({
		canvas,
		sketch,
		preset: 'high',
		maxPixelRatio: params.has('seconds') ? undefined : 1,
		antialias: ANTIALIAS,
		gpuOcclusion,
	});
	await engine.firstFrame;
	return engine;
}

/**
 * Turns the camera to a view, and resolves once the sketch has turned it and a frame drew it, with
 * whether the engine culls occluded objects on the GPU.
 */
function turn(engine: Engine, view: number): Promise<boolean> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((name, occlusion) => {
			if (name !== 'turned') return;
			off();
			// The frame that draws the turn reaches the thread that draws a frame or two later, and a
			// frame read back draws the newest frame that thread took.
			setTimeout(() => resolve(occlusion === true), TURN_SETTLE_MS);
		});
		engine.postToSketch('view', view);
	});
}

/** The frames that an engine draws in each view, in the scene's order of views. */
async function framesOf(gpuOcclusion: boolean, failures: string[]) {
	const engine = await start(gpuOcclusion);
	engine.onFailure((error) => failures.push(error.code));
	const frames: Uint8Array[] = [];
	let occlusion = false;
	for (let view = 0; view < ROOM_VIEWS.length; view++) {
		occlusion = await turn(engine, view);
		frames.push((await engine.captureFrame()).pixels);
	}
	const image = params.has('images')
		? toBase64(new Uint8Array(await (await engine.capture()).arrayBuffer()))
		: undefined;
	const facts = { tier: engine.capabilities.tier, occlusion, image };
	await engine.destroy();
	return { frames, facts };
}

/** Pixels whose color differs between two frames of the same size. */
function differing(a: Uint8Array, b: Uint8Array): number {
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
	return count;
}

/** Each side's medians of GPU time, frame interval and CPU time in view 0, in turns. */
async function cost() {
	const sides = {
		off: { gpuMs: [] as number[], intervalMs: [] as number[], cpuMs: [] as number[] },
		on: { gpuMs: [] as number[], intervalMs: [] as number[], cpuMs: [] as number[] },
	};
	/** Each side's GPU time per frame in each pass, by the pass's name, from its last round. */
	const passes: Record<string, Record<string, number>> = {};
	let aspect = 16 / 9;
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			const engine = await start(side === 'on');
			aspect = innerWidth / innerHeight;
			await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
			const stats = await engine.measure(SECONDS);
			if (stats.gpuMs) sides[side].gpuMs.push(stats.gpuMs.median);
			sides[side].intervalMs.push(stats.intervalMs.median);
			sides[side].cpuMs.push(stats.cpuMs.median);
			passes[side] = Object.fromEntries(
				(stats.gpuPassMs ?? []).map(({ name, ms }) => [name, ms.median]),
			);
			await engine.destroy();
		}
	}
	const summary = (side: 'off' | 'on') => ({
		gpuMs: median(sides[side].gpuMs),
		intervalMs: median(sides[side].intervalMs),
		cpuMs: median(sides[side].cpuMs),
	});
	return {
		hiddenShare: hiddenShare(ROOM_VIEWS[0] ?? 0, aspect),
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off: summary('off'),
		on: summary('on'),
		passes,
	};
}

run('gpu-occlusion', async () => {
	const failures: string[] = [];
	const off = await framesOf(false, failures);
	const on = await framesOf(true, failures);
	const differingPixels = off.frames.map((frame, view) =>
		differing(frame, on.frames[view] ?? frame),
	);
	const images =
		off.facts.image && on.facts.image ? { off: off.facts.image, on: on.facts.image } : undefined;
	return {
		tier: on.facts.tier,
		occlusion: { off: off.facts.occlusion, on: on.facts.occlusion },
		...(images && { images }),
		views: ROOM_VIEWS.length,
		differingPixels,
		...(SECONDS > 0 && { cost: await cost() }),
		failures,
	};
});
