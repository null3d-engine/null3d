// Measures what the ambient occlusion chain costs on this device with the engine's own shaders,
// outside the engine: a depth copy, a horizon search and a denoise, drawn from a worker as the
// engine draws, then a fence as its completion path places one. The control draws only the copy.
// It exists to show the fault outside the engine, so a browser report can carry it: on iPhones with
// recent Safari the chain costs a fixed few milliseconds a frame whatever the drawn area.
//
// ?aoscale=0.5 draws half the render size each way, as the presets do; 0.25 draws a quarter.
// ?mode=copy measures the depth copy alone, and ?mode=none only the synthetic scene depth.
// ?present=off skips the canvas draw that a frame ends with, and ?ratio= sets the canvas's pixel
// ratio (3 at most, the display's own unless the address names one).
import { publish, progress } from '../../../tests/pages/lib/result.ts';

const params = new URLSearchParams(location.search);
const aoScale = Number(params.get('aoscale') ?? '0.5');
const mode = params.get('mode') ?? 'ao';
const present = params.get('present') !== 'off';
const opaque = Number(params.get('opaque') ?? '0');
const msaa = params.get('msaa') === 'on';
const highPerformance = params.get('power') === 'high';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ratio = Number(params.get('ratio') ?? Math.min(devicePixelRatio || 1, 3));
const width = Math.max(1, Math.floor(innerWidth * ratio));
const height = Math.max(1, Math.floor(innerHeight * ratio));
canvas.width = width;
canvas.height = height;

// A transferred canvas draws from this worker without the page's main thread, as the engine's
// render worker draws.
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const offscreen = canvas.transferControlToOffscreen();
progress(`webgl2 ${width}x${height}, drawn ${Math.round(width * aoScale)}x${Math.round(height * aoScale)}, mode ${mode}`);

worker.onmessage = (event: MessageEvent<{ type: string; [key: string]: unknown }>) => {
	const data = event.data;
	if (data.type !== 'done') return;
	const trail = (data.trail as string[]) ?? [];
	for (const step of trail) progress(step);
	const failures = (data.failures as string[]) ?? [];
	void publish('ao-fixed-cost', {
		ok: failures.length === 0,
		tier: 'webgl2',
		effect: 'ao',
		scale: 1,
		hdr: true,
		aoscale: aoScale,
		mode,
		present,
		opaque,
		window: [innerWidth, innerHeight],
		devicePixelRatio: ratio,
		targets: [width, height, Math.round(width * aoScale), Math.round(height * aoScale)],
		off: data.off,
		on: data.on,
		failures,
	});
};
worker.onerror = (event) =>
	publish('ao-fixed-cost', {
		ok: false,
		tier: 'webgl2',
		effect: 'ao',
		scale: 1,
		failures: [`the worker failed: ${event.message}`],
	});

worker.postMessage(
	{ type: 'start', canvas: offscreen, width, height, aoScale, mode, present, opaque, msaa, highPerformance },
	[
	offscreen,
]);
