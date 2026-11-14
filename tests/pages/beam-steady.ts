// A live scene of the volumetric fog that keeps drawing, for the test that watches a still beam's
// frames. Its sketch holds the camera and the lights still, and the test starts the page with
// ?still-camera=off so the engine's still-camera accumulation does not average the frames, which
// would hide a change that the fog's own steps make. ?size= gives the canvas in pixels.
import { createEngine } from '@null3d/engine';

const params = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
const [width, height] = (params.get('size') ?? '480x300').split('x').map(Number);
canvas.style.width = `${width}px`;
canvas.style.height = `${height}px`;
const sketch = new URL('./sketches/beam-steady-sketch.ts', import.meta.url);
if (params.get('volumetric') === 'off') sketch.searchParams.set('volumetric', 'off');
const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
(globalThis as { __null3dEngine?: unknown }).__null3dEngine = engine;
await engine.firstFrame;
