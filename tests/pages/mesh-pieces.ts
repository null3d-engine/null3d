// Copies that cull each piece of their mesh against copies that draw it whole: the page starts the
// engine on a scene without pieces, then with them, moves the camera through the scene's views in
// the same order on both, and reads a frame back in each. It counts the pixels where the two
// engines' frames differ, which must be none, and the triangles that each side drew in the first
// view, which pieces must cut, with their draw calls. The scene is the rock field of
// `sketches/mesh-pieces-sketch.ts`, whose file holds its pieces, or with ?scene=houses the village
// of `sketches/mesh-facing-pieces-sketch.ts`, whose house takes facing pieces once its copies draw:
// that side waits until its triangles fall below the whole side's. Each side captures a frame and
// measures again while its window records none, since a software GPU may take longer than the
// window to draw a heavy field once. The village's ?file= and ?copies= reach its sketch; with ?copies= no
// side waits, since too few copies take no pieces. The address's GPU switches, such as ?gpu= and
// ?direct=, reach both engines.
import { createEngine, type Engine } from '@null3d/engine';
import { differingPixels } from './lib/occlusion';
import { run } from './lib/result';
import { HOUSE_VIEWS } from './sketches/mesh-facing-pieces-sketch';
import { VIEWS as ROCK_VIEWS } from './sketches/mesh-pieces-sketch';

const params = new URLSearchParams(location.search);
const HOUSES = params.get('scene') === 'houses';
const VIEWS = HOUSES ? HOUSE_VIEWS : ROCK_VIEWS;
/** True when the side with pieces waits for them: a village whose copies pay for them. */
const WAITS = HOUSES && !params.has('copies');

/** Seconds of drawing that each side measures its triangles over, in the first view. */
const MEASURE_SECONDS = 0.5;
/** The most measures that a side takes while it waits for a frame in the window to draw. */
const FRAME_WAITS = 40;
/** The most measures that the side with pieces takes while it waits for its pieces to plan. */
const PLAN_WAITS = 40;

/** Starts an engine on a new canvas, with or without pieces. */
async function start(pieces: boolean): Promise<Engine> {
	document.querySelector('canvas')?.remove();
	const canvas = document.createElement('canvas');
	canvas.style.width = '320px';
	canvas.style.height = '180px';
	document.body.prepend(canvas);
	const sketch = HOUSES
		? new URL('./sketches/mesh-facing-pieces-sketch.ts', import.meta.url)
		: new URL('./sketches/mesh-pieces-sketch.ts', import.meta.url);
	sketch.search = `?pieces=${pieces ? 1 : 0}`;
	for (const name of ['file', 'copies']) {
		const value = params.get(name);
		if (HOUSES && value !== null) sketch.searchParams.set(name, value);
	}
	const engine = await createEngine({ canvas, sketch, preset: 'high', maxPixelRatio: 1 });
	await engine.firstFrame;
	return engine;
}

/**
 * Measures the engine over a window that holds a drawn frame. A software GPU may take longer than
 * the window to draw a heavy field once, and a window that records no frame has no triangles to
 * judge, so the measurement repeats while it records none.
 */
async function measureDrawn(engine: Engine): Promise<Awaited<ReturnType<Engine['measure']>>> {
	let measured = await engine.measure(MEASURE_SECONDS);
	for (let k = 0; measured.triangles.count === 0 && k < FRAME_WAITS; k++)
		measured = await engine.measure(MEASURE_SECONDS);
	return measured;
}

/** Moves the camera to a view, and resolves once the thread that draws has taken a frame there. */
function turn(engine: Engine, view: number): Promise<void> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((name) => {
			if (name !== 'turned') return;
			off();
			resolve();
		});
		engine.postToSketch('view', view);
	});
}

/**
 * The frames that an engine draws in each view, and the triangles it draws in the first one. Every
 * measurement waits for a drawn frame. A side with pieces that plan at run time measures until it
 * draws fewer triangles than `whole`.
 */
async function framesOf(pieces: boolean, failures: string[], whole = 0) {
	const engine = await start(pieces);
	engine.onFailure((error) => failures.push(error.code));
	await turn(engine, 0);
	// A capture waits for the thread that draws, so the measurement that follows holds a frame even
	// where that thread's first draw compiles its shaders for longer than the window.
	await engine.captureFrame();
	let measured = await measureDrawn(engine);
	for (let k = 0; WAITS && pieces && measured.triangles.median >= whole && k < PLAN_WAITS; k++)
		measured = await measureDrawn(engine);
	const frames: Uint8Array[] = [];
	for (let view = 0; view < VIEWS.length; view++) {
		await turn(engine, view);
		frames.push((await engine.captureFrame()).pixels);
	}
	const facts = {
		tier: engine.capabilities.tier,
		directDraws: engine.capabilities.directDraws,
		triangles: measured.triangles.median,
		draws: measured.drawCalls.median,
	};
	await engine.destroy();
	return { frames, facts };
}

run('mesh-pieces', async () => {
	const failures: string[] = [];
	const whole = await framesOf(false, failures);
	const pieces = await framesOf(true, failures, whole.facts.triangles);
	return {
		tier: pieces.facts.tier,
		directDraws: pieces.facts.directDraws,
		views: VIEWS.length,
		differingPixels: whole.frames.map((frame, view) =>
			differingPixels(frame, pieces.frames[view] ?? frame),
		),
		triangles: { whole: whole.facts.triangles, pieces: pieces.facts.triangles },
		draws: { whole: whole.facts.draws, pieces: pieces.facts.draws },
		failures,
	};
});
