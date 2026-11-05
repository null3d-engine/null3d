// Copies that cull each group of their level against copies that cull only its pieces: the page
// starts the engine on the rock field of `sketches/mesh-pieces-sketch.ts` twice, once with pieces
// and once with pieces whose triangles also split into groups (NULL3D_pieces version 2), moves the
// camera through the same views on both, and reads a frame back in each. Groups only order the
// triangles inside a piece, and a group lies inside its piece, so both sides must draw the same
// pixels: it counts those that differ, which must be none. The side with groups must also draw
// fewer triangles in the first view, since the slot pass culls the groups of the copies that carry
// the most triangles of a level. The address's GPU switches, such as ?gpu= and ?direct=, reach both
// engines.
import { createEngine, type Engine } from '@null3d/engine';
import { differingPixels } from './lib/occlusion';
import { run } from './lib/result';
import { VIEWS } from './sketches/mesh-pieces-sketch';

/** Seconds of drawing that each side measures its triangles over, in the first view. */
const MEASURE_SECONDS = 0.5;

/** Starts an engine on a new canvas, with or without the fine level's groups. */
async function start(groups: boolean): Promise<Engine> {
	document.querySelector('canvas')?.remove();
	const canvas = document.createElement('canvas');
	canvas.style.width = '320px';
	canvas.style.height = '180px';
	document.body.prepend(canvas);
	const sketch = new URL('./sketches/mesh-pieces-sketch.ts', import.meta.url);
	sketch.search = `?pieces=1${groups ? '&groups=1' : ''}`;
	// A view culls in one phase at Medium, which is where the slot pass draws.
	const engine = await createEngine({ canvas, sketch, preset: 'medium', maxPixelRatio: 1 });
	await engine.firstFrame;
	return engine;
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

/** The frames that an engine draws in each view, and the triangles it draws in the first one. */
async function framesOf(groups: boolean, failures: string[]) {
	const engine = await start(groups);
	engine.onFailure((error) => failures.push(error.code));
	await turn(engine, 0);
	const measured = await engine.measure(MEASURE_SECONDS);
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

run('mesh-groups', async () => {
	const failures: string[] = [];
	const pieces = await framesOf(false, failures);
	const groups = await framesOf(true, failures);
	return {
		tier: groups.facts.tier,
		directDraws: groups.facts.directDraws,
		views: VIEWS.length,
		differingPixels: pieces.frames.map((frame, view) =>
			differingPixels(frame, groups.frames[view] ?? frame),
		),
		triangles: { pieces: pieces.facts.triangles, groups: groups.facts.triangles },
		draws: { pieces: pieces.facts.draws, groups: groups.facts.draws },
		failures,
	};
});
