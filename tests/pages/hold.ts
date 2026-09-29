// Starts the engine as an app's own page would, and handles no error, so a test reads what hold
// mode itself publishes on the page. ?sketch= picks the sketch: animated (the default), throwing,
// whose update throws at half a second, or failing-setup, whose setup throws an engine error. Once
// the engine has started, the page asks the sketch for its state and notes whether the page's own
// Math.random changed. Then it stops the engine, and publishes all of it with whether the page got
// its Math.random back.
import { createEngine } from '@null3d/engine';
import './lib/result';

declare global {
	interface Window {
		__null3dSketchState?: unknown;
	}
}

const own = Math.random;
const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
const sketch = new URLSearchParams(location.search).get('sketch') ?? 'animated';
const engine = await createEngine({
	canvas,
	sketch: new URL(`./sketches/${sketch}-sketch.ts`, import.meta.url),
	maxPixelRatio: 1,
});
const state = await new Promise((resolve) => {
	engine.onSketchMessage((name, data) => {
		if (name === 'state') resolve(data);
	});
	engine.postToSketch('state');
});
const seededOnPage = Math.random !== own;
await engine.destroy();
window.__null3dSketchState = {
	state,
	mode: engine.mode,
	tier: engine.capabilities.tier,
	seededOnPage,
	ownAfterStop: Math.random === own,
};
