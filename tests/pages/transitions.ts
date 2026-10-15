// Starts the engine with the transitions sketch: a row of Knights that switch between a walk and
// a run, with `?transition=blend` or `?transition=inertial` picking how the switch fades.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
await createEngine({
	canvas,
	sketch: new URL('./sketches/transitions-sketch.ts', import.meta.url),
});
