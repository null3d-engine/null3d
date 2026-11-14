// The add-on's ocean page: it starts the engine on its canvas with the ocean's sketch. The listing
// check's gates read the frames that the page draws, so the page needs no test code of its own.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
await createEngine({ canvas, sketch: new URL('./ocean-sketch.ts', import.meta.url) });
