// A live page of a reflection on water, whose camera jumps each half second. ?every draws the
// reflection once in that many frames. See reflection-lag.spec.ts.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const every = new URLSearchParams(location.search).get('every') ?? '1';
const sketch = new URL('./sketches/reflection-sketch.ts', import.meta.url);
sketch.search = `?water&jump&every=${every}`;
(globalThis as { __ready?: boolean }).__ready = false;
await createEngine({ canvas, sketch, preset: 'high' });
(globalThis as { __ready?: boolean }).__ready = true;
