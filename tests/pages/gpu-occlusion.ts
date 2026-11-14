// GPU occlusion culling against culling without it, in the room scene (bench/scenes/room.ts): a
// room whose walls, its occluders, hide most of a field of detailed spheres. The page starts the
// engine without occlusion culling, then with it, at the High preset, and turns the camera through
// the scene's views in the same order on both. Each turn faces another wall, so the objects that
// drew in the frame before are not the ones in view. After each turn it reads a frame back, and
// counts the pixels where the two engines' frames differ. A frame read back draws the newest frame
// again, so it also checks that drawing with an up-to-date history changes nothing. The first turn
// waits for the spheres' levels of detail, so both engines draw every view at the same levels, and
// the near spheres hide others at the levels that the frame draws. The engine with culling first
// waits until the culling hides objects, and the image tests start the page with
// ?occlusion-check=off, which runs the culling's passes in every frame, and ?direct=off, which keeps
// the indirect draws where the culling runs: otherwise its check can turn the passes off, or the
// start-up probe can pick the direct-draw path, and a view drawn without them proves nothing.
//
// With ?seconds=, the page then measures play in view 0, facing a doorway, for that many seconds on
// each side, ?rounds= times in turns, and reports the medians of each side's GPU time per frame,
// where the device has a GPU timer, and of its frame interval, CPU time, GPU latency from submit to
// completion and the objects that the culling hid, beside the share of the spheres that the walls
// hide. The device runner's occlusion plan runs it that way.
import { createEngine, type Engine } from '@null3d/engine';
import { hiddenShare, ROOM_VIEWS } from '../../bench/scenes/room';
import { differingPixels, median } from './lib/occlusion';
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
/** Seconds of play before the first measurement of each engine. */
const WARM_UP_SECONDS = 1;
/** Seconds that an engine with occlusion culling may take to hide its first object. */
const CULLING_WAIT_SECONDS = 60;

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
 * What the sketch posts after a turn: whether the engine culls occluded objects on the GPU, and
 * the levels of detail that the spheres hold.
 */
interface Turned {
	occlusion: boolean;
	levels: number;
}

/**
 * Turns the camera to a view, and resolves once the thread that draws has taken a frame with the
 * turn, with what the sketch posted. A frame read back draws the newest frame that thread took.
 */
function turn(engine: Engine, view: number): Promise<Turned> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((name, data) => {
			if (name !== 'turned') return;
			off();
			resolve(data as Turned);
		});
		engine.postToSketch('view', view);
	});
}

/**
 * Waits until the engine's GPU occlusion culling hides objects in the first view, so that the
 * frames compared after it run the culling's passes: its shaders load on first use, a few frames
 * after the start. With ?occlusion-check=off the passes then run in every frame. False when
 * nothing hid in time.
 */
async function cullingHides(engine: Engine): Promise<boolean> {
	const end = performance.now() + CULLING_WAIT_SECONDS * 1000;
	while (performance.now() < end)
		if (((await engine.measure(0.25)).occludedEntries?.mean ?? 0) > 0) return true;
	return false;
}

/** The frames that an engine draws in each view, in the scene's order of views. */
async function framesOf(gpuOcclusion: boolean, failures: string[]) {
	const engine = await start(gpuOcclusion);
	engine.onFailure((error) => failures.push(error.code));
	if (gpuOcclusion && !(await cullingHides(engine)))
		failures.push(`GPU occlusion culling hid nothing in ${CULLING_WAIT_SECONDS} s`);
	const frames: Uint8Array[] = [];
	let turned: Turned = { occlusion: false, levels: 0 };
	for (let view = 0; view < ROOM_VIEWS.length; view++) {
		turned = await turn(engine, view);
		frames.push((await engine.captureFrame()).pixels);
	}
	const image = params.has('images')
		? toBase64(new Uint8Array(await (await engine.capture()).arrayBuffer()))
		: undefined;
	const { tier, directDraws } = engine.capabilities;
	const facts = { tier, directDraws, ...turned, image };
	await engine.destroy();
	return { frames, facts };
}

/** Each side's medians of GPU time, frame interval and CPU time in view 0, in turns. */
async function cost() {
	const sides = {
		off: {
			gpuMs: [] as number[],
			intervalMs: [] as number[],
			cpuMs: [] as number[],
			latencyMs: [] as number[],
			occluded: [] as number[],
		},
		on: {
			gpuMs: [] as number[],
			intervalMs: [] as number[],
			cpuMs: [] as number[],
			latencyMs: [] as number[],
			occluded: [] as number[],
		},
	};
	/** Each side's GPU time per frame in each pass, by the pass's name, from its last round. */
	const passes: Record<string, Record<string, number>> = {};
	let aspect = 16 / 9;
	let directDraws = false;
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			const engine = await start(side === 'on');
			aspect = innerWidth / innerHeight;
			await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
			const stats = await engine.measure(SECONDS);
			directDraws = engine.capabilities.directDraws;
			if (stats.gpuMs) sides[side].gpuMs.push(stats.gpuMs.median);
			sides[side].intervalMs.push(stats.intervalMs.median);
			sides[side].cpuMs.push(stats.cpuMs.median);
			if (stats.gpuLatencyMs) sides[side].latencyMs.push(stats.gpuLatencyMs.median);
			if (stats.occludedEntries) sides[side].occluded.push(stats.occludedEntries.median);
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
		latencyMs: median(sides[side].latencyMs),
		occluded: median(sides[side].occluded),
	});
	return {
		hiddenShare: hiddenShare(ROOM_VIEWS[0] ?? 0, aspect),
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		directDraws,
		off: summary('off'),
		on: summary('on'),
		passes,
	};
}

run('gpu-occlusion', async () => {
	const failures: string[] = [];
	const off = await framesOf(false, failures);
	const on = await framesOf(true, failures);
	const differing = off.frames.map((frame, view) =>
		differingPixels(frame, on.frames[view] ?? frame),
	);
	const images =
		off.facts.image && on.facts.image ? { off: off.facts.image, on: on.facts.image } : undefined;
	return {
		tier: on.facts.tier,
		occlusion: { off: off.facts.occlusion, on: on.facts.occlusion },
		levels: { off: off.facts.levels, on: on.facts.levels },
		directDraws: on.facts.directDraws,
		...(images && { images }),
		views: ROOM_VIEWS.length,
		differingPixels: differing,
		...(SECONDS > 0 && { cost: await cost() }),
		failures,
	};
});
