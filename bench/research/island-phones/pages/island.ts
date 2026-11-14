// The Island's held view on a canvas of a phone's drawing size, for the phones study. It starts the
// engine as the Island's demo page does (moment transparency on), at the preset and anti-aliasing
// that the address names, with the pixel ratio at 1 by default so the canvas's size is the drawing
// size. After a warm-up it measures one window per step. A step names the parts to hide, joined by
// `.`, or `base` for none, or `set:` and a JSON object of live quality settings, or `try:` and a
// trial change that the sketch applies for that window alone. Switches:
//   ?preset=auto|low|medium|high  ?aa=fxaa|msaa|none  ?mt=0|1  ?prepass=0|1
//   ?w=&h= (canvas CSS pixels)  ?fill (the canvas fills the window)  ?dpr=<n>|preset
//   ?scale= (render scale, held)  ?governor=on (the governor moves the scale instead)
//   ?warm= seconds  ?seconds= per window  ?steps=base,ground,base,town.trees  ?pose=x,y,z,tx,ty,tz
import { createEngine, type Engine } from '@null3d/engine';
import { progress, run } from '../../../../tests/pages/lib/result';

const params = new URLSearchParams(location.search);
const number = (name: string, fallback: number) => Number(params.get(name) ?? fallback);
const width = number('w', 384);
const height = number('h', 832);
const warm = number('warm', 25);
const seconds = number('seconds', 4);
const steps = (params.get('steps') ?? 'base').split(',');
const pause = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/** Posts a message and waits for the sketch's answer. */
function ask(engine: Engine, name: string, data: unknown, answer: string): Promise<unknown> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((got, value) => {
			if (got !== answer) return;
			off();
			resolve(value);
		});
		engine.postToSketch(name, data);
	});
}

run('island-phones', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	if (params.has('fill')) {
		canvas.style.width = '100vw';
		canvas.style.height = '100vh';
	}
	const sketch = new URL('./island-sketch.ts', import.meta.url);
	for (const name of ['pose', 'scale', 'governor'])
		if (params.has(name)) sketch.searchParams.set(name, params.get(name) as string);
	sketch.searchParams.set('module', 'ts');
	const dpr = params.get('dpr') ?? '1';
	const engine = await createEngine({
		canvas,
		sketch,
		preset: (params.get('preset') ?? 'medium') as 'medium',
		antialias: (params.get('aa') ?? undefined) as 'msaa' | undefined,
		momentTransparency: params.get('mt') !== '0',
		...(params.has('prepass') && { depthPrepass: params.get('prepass') === '1' }),
		stats: false,
		...(dpr !== 'preset' && { maxPixelRatio: Number(dpr) }),
	});
	await engine.firstFrame;
	progress('first frame');
	await pause(warm);
	const windows = [];
	for (const step of steps) {
		const tried = step.startsWith('try:') ? step.slice(4) : undefined;
		if (tried) await ask(engine, 'try', { trial: tried, on: true }, 'tried');
		else if (step.startsWith('set:'))
			await ask(engine, 'set', JSON.parse(decodeURIComponent(step.slice(4))), 'settled');
		else await ask(engine, 'hide', step === 'base' ? [] : step.split('.'), 'hidden');
		await pause(1.5);
		const m = await engine.measure(seconds);
		if (tried) await ask(engine, 'try', { trial: tried, on: false }, 'tried');
		windows.push({
			step,
			frames: m.frames,
			intervalMs: m.intervalMs.median,
			gpuMs: m.gpuMs.median,
			gpuPassMs: Object.fromEntries(m.gpuPassMs.map((p) => [p.name, p.ms.median])),
			render: m.threads['render-worker']?.busyMs.median ?? null,
			triangles: m.triangles.median,
			drawCalls: m.drawCalls.median,
		});
		progress(`step ${step}`);
	}
	const census = await ask(engine, 'census', null, 'censused');
	const result = { tier: engine.capabilities.tier, mode: { ...engine.mode }, census, windows };
	await engine.destroy();
	return result;
});
