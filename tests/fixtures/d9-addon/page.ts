// The fixture's page: it starts the engine on its canvas with the fixture's sketch. The add-on
// check reads the held frame, so the page needs no test code of its own.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
