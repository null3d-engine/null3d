// Shader files that load before play. ?mode=list starts the engine with a preload list, then turns
// those features on during play: skinned characters, bloom and a line batch. ?mode=gltf loads
// animated glTF characters in the sketch's setup, whose skins start the skinning file's download
// as the file is read. ?mode=unknown names a feature that does not exist. The page tells the test
// when the first frame came, through the `__mark` binding, so the test can split the shader files
// that downloaded before it from those after it. It captures the first frame and one after play
// settled, and measures play across the change. ?preload=off leaves the list out, and the page
// reports the time from createEngine to the first frame, so runs with and without the list give
// what the list adds to the start.
import { createEngine, type EngineOptions } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') ?? 'list';
/** How long the page measures play after the change, and then lets frames settle. */
const ACROSS_SECONDS = 1.5;
const SETTLE_SECONDS = 0.5;

/** Tells the test of a moment in the page's run, when the test listens. */
function mark(name: string): void {
	(globalThis as { __mark?: (name: string) => void }).__mark?.(name);
}

/** The engine's options for each mode. */
function options(canvas: HTMLCanvasElement): EngineOptions {
	const sketch = (path: string) => new URL(path, import.meta.url);
	const common = { canvas, maxPixelRatio: 1, onSketchMessage: (name: string) => mark(name) };
	if (MODE === 'gltf')
		return { ...common, sketch: sketch('./sketches/gltf-animated-sketch.ts?still&mark') };
	// ?preload=off starts the same scene without the list, to time what the list adds to the start.
	const list = params.get('preload') === 'off' ? [] : ['skinning', 'bloom', 'lines'];
	const preload = (MODE === 'unknown' ? ['skining'] : list) as never;
	return { ...common, sketch: sketch('./sketches/skinning-sketch.ts?still&late&extras'), preload };
}

run('preload', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const startedAt = performance.now();
	const engine = await createEngine(options(canvas));
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const firstFrameMs = performance.now() - startedAt;
	mark('first-frame');
	const first = await engine.captureFrame();
	let acrossSkippedDraws = 0;
	if (MODE === 'list') {
		const added = new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'added') return;
				off();
				resolve();
			});
		});
		const across = engine.measure(ACROSS_SECONDS);
		engine.postToSketch('characters', null);
		await added;
		acrossSkippedDraws = (await across).skippedDraws;
	}
	await engine.measure(SETTLE_SECONDS);
	const later = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		first: toBase64(first.pixels),
		later: toBase64(later.pixels),
		acrossSkippedDraws,
		firstFrameMs,
		failures,
	};
});
