// The page module, on the main thread: it owns the DOM and starts the engine.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('The page has no canvas element.');

const engine = await createEngine({
	canvas,
	sketch: new URL('./sketch.ts', import.meta.url),
});

await engine.firstFrame;
