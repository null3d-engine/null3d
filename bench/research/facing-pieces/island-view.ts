// Temporary measuring page: the Island at a fixed town view, timed after the levels and pieces
// settle. ?pose=x,y,z,tx,ty,tz, ?preset=, ?warm= seconds, ?seconds=, ?hide-walls.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const pose = (params.get('pose') ?? '-92,36,360,-92,26,200').split(',').map(Number);
const warm = Number(params.get('warm') ?? 25);
const seconds = Number(params.get('seconds') ?? 10);
const preset = (params.get('preset') ?? 'high') as 'high';

run('island-view', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/island-view-sketch.ts', import.meta.url),
		preset,
		momentTransparency: true,
		stats: false,
		maxPixelRatio: 1,
	});
	engine.postToSketch('pose', pose);
	await engine.firstFrame;
	progress('first frame');
	await new Promise((r) => setTimeout(r, warm * 1000));
	if (params.has('hide-walls')) {
		engine.postToSketch('hide-walls');
		await new Promise((r) => setTimeout(r, 2000));
	}
	const windows = [];
	for (let k = 0; k < Number(params.get('windows') ?? 1); k++) {
		const m = await engine.measure(seconds);
		windows.push({
			frames: m.frames,
			intervalMs: m.intervalMs,
			gpuMs: m.gpuMs,
			gpuPassMs: m.gpuPassMs,
			triangles: m.triangles,
			drawCalls: m.drawCalls,
		});
	}
	const result = {
		tier: engine.capabilities.tier,
		mode: { ...engine.mode },
		...windows[0],
		windows,
	};
	await engine.destroy();
	return result;
});
