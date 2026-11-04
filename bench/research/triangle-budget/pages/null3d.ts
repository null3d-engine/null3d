// The null3D page of the triangle budget study. It starts the engine as the desert's benchmark page
// does (Medium, MSAA, GPU occlusion culling) on a canvas of 1920 x 1080 at one device pixel per CSS
// pixel, and gives the runner `globalThis.__tb`:
// - `set(t, lod, lodShadow)` holds the camera at time t of the lap with those level thresholds;
// - `shot()` returns the next frame as a PNG file in base64;
// - `measure(seconds)` returns the median triangles, draw calls and GPU time of that many seconds.
// Switches: `?view=walk|aerial`, `?shadows=<cascades>`, and the engine's own, such as
// `?still-camera=off`, which the runner sets so that a held camera still draws every frame in full.
import { createEngine } from '@null3d/engine';
import { DESERT_CANVAS, readDesertView } from '../../../scenes/desert';

const params = new URLSearchParams(location.search);
const status = document.querySelector('#status') as HTMLElement;
const canvas = document.createElement('canvas');
canvas.style.width = `${DESERT_CANVAS.width}px`;
canvas.style.height = `${DESERT_CANVAS.height}px`;
canvas.style.display = 'block';
document.body.append(canvas);
const sketch = new URL('./null3d-sketch.ts', import.meta.url);
sketch.searchParams.set('view', readDesertView(params));
if (params.has('shadows')) sketch.searchParams.set('shadows', params.get('shadows') as string);

const waiters = new Map<string, () => void>();
const once = (name: string) => new Promise<void>((resolve) => waiters.set(name, resolve));
const ready = once('ready');
const engine = await createEngine({
	canvas,
	sketch,
	preset: 'medium',
	antialias: 'msaa',
	gpuOcclusion: true,
	memory: { maximumMiB: 4096 },
	maxPixelRatio: 1,
	onSketchMessage: (name) => {
		waiters.get(name)?.();
		waiters.delete(name);
	},
});
await ready;
await engine.firstFrame;

const frames = (n: number) =>
	new Promise<void>((resolve) => {
		const step = (left: number) =>
			left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
		step(n);
	});

const toBase64 = async (blob: Blob) => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
};

(globalThis as Record<string, unknown>).__tb = {
	engine: 'null3d',
	async set(t: number, lod: number, lodShadow: number) {
		const placed = once('placed');
		engine.postToSketch('set', { t, lod, lodShadow });
		await placed;
		// Two-phase occlusion and the copy lists settle within a few frames of a change.
		await frames(30);
	},
	async shot() {
		return { png: await toBase64(await engine.capture()) };
	},
	async measure(seconds: number) {
		const m = await engine.measure(seconds);
		return {
			triangles: m.triangles?.median ?? null,
			drawCalls: m.drawCalls?.median ?? null,
			gpuMs: m.gpuMs?.median ?? null,
			intervalMs: m.intervalMs.median,
			drawPath: engine.capabilities.drawPath,
		};
	},
};
status.textContent = 'ready';
(globalThis as Record<string, unknown>).__tbReady = true;
