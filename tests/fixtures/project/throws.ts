// A page whose sketch throws once it has run for half a second, so a hold stops there.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
await createEngine({ canvas, sketch: new URL('./throwing-sketch.ts', import.meta.url) });
