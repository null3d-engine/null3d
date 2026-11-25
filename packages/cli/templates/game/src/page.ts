// The page module, on the main thread: it owns the DOM, starts the engine and shows the score.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
const score = document.querySelector('#score');
if (!canvas || !score) throw new Error('The page needs its canvas and its score element.');

const engine = await createEngine({
	canvas,
	sketch: new URL('./sketch.ts', import.meta.url),
});

// The sketch posts the score each time a gem is taken.
engine.onSketchMessage((name, data) => {
	if (name === 'score') score.textContent = `Gems: ${String(data)}`;
});

await engine.firstFrame;
