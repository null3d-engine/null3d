// The fresh project's page: it starts the engine on its canvas with the project's sketch.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
