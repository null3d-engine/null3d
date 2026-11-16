// The null3D page of the triangle budget study. It starts the engine as the desert's benchmark page
// does (Medium, MSAA, GPU occlusion culling) on a canvas of 1920 x 1080 at one device pixel per CSS
// pixel, and gives the runner `globalThis.__tb`:
// - `set(t)` holds the camera at time t of the lap;
// - `shot()` returns the next frame as a PNG file in base64;
// - `measure(seconds)` returns the median triangles, draw calls and GPU time of that many seconds.
// Switches: `?view=walk|aerial`, `?shadows=<cascades>`, `?lod=` and `?lodShadow=`, the level
// thresholds in pixels and shadow texels, which hold for the page's life, `?at=`, the first camera
// time, and the engine's own. The measurement sways the camera by a millimeter, so the engine draws
// every frame in full; `?still-camera=off` would do the same but leaves the desert's ground undrawn.
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
for (const name of ['shadows', 'lod', 'lodShadow', 'at', 'lift'])
	if (params.has(name)) sketch.searchParams.set(name, params.get(name) as string);
// The dev server reads a module's language from the end of its address, so an address that ends in
// a number such as 1.5 would not load as TypeScript: a last switch without a dot keeps it whole.
sketch.searchParams.set('module', 'ts');

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
	async set(t: number) {
		// A camera that jumps after the desert has loaded leaves its ground undrawn, so the runner
		// opens a page at each time, and moves the camera only when asked for another.
		if (t !== Number(params.get('at') ?? 0)) {
			const placed = once('placed');
			engine.postToSketch('set', { t });
			await placed;
		}
		// Two-phase occlusion and the copy lists settle within a few frames of a change.
		await frames(30);
	},
	async shot() {
		return { png: await toBase64(await engine.capture()) };
	},
	async measure(seconds: number) {
		engine.postToSketch('sway', { on: true });
		await frames(10);
		const m = await engine.measure(seconds);
		engine.postToSketch('sway', { on: false });
		await frames(10);
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
