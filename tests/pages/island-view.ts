// Temporary measuring page: the Island at a fixed town view, timed after the levels and pieces
// settle. ?pose=x,y,z,tx,ty,tz, ?preset=, ?warm= seconds, ?seconds=, ?windows=, ?hide-walls.
// ?toggle-ground=N takes N rounds of windows with the terrain's blocks shown and hidden, in the
// order shown, hidden, hidden, shown, so a drift over the page's life cancels out. Not kept in the
// repository.
import { createEngine, type Engine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const pose = (params.get('pose') ?? '-92,36,360,-92,26,200').split(',').map(Number);
const warm = Number(params.get('warm') ?? 25);
const seconds = Number(params.get('seconds') ?? 10);
const settle = Number(params.get('settle') ?? 1.5);
const preset = (params.get('preset') ?? 'high') as 'high';
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

/** One window's figures. */
async function window(engine: Engine, label: string) {
	const m = await engine.measure(seconds);
	return {
		label,
		frames: m.frames,
		intervalMs: m.intervalMs,
		gpuMs: m.gpuMs,
		gpuPassMs: m.gpuPassMs,
		cpuMs: m.cpuMs,
		render: m.threads['render-worker']?.busyMs ?? null,
		sketch: m.threads['sketch-worker']?.busyMs ?? null,
		triangles: m.triangles,
		drawCalls: m.drawCalls,
		uploadBytes: m.uploadBytes,
	};
}

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
	await pause(warm);
	if (params.has('hide-walls')) {
		engine.postToSketch('hide-walls');
		await pause(2);
	}
	const windows = [];
	const rounds = Number(params.get('toggle-ground') ?? 0);
	if (rounds > 0) {
		const order = [false, true, true, false];
		for (let round = 0; round < rounds; round++)
			for (const hidden of order) {
				await ask(engine, 'ground', !hidden, 'groundn');
				await pause(settle);
				windows.push(await window(engine, hidden ? 'hidden' : 'shown'));
				progress(`round ${round} ${hidden ? 'hidden' : 'shown'}`);
			}
		await ask(engine, 'ground', true, 'groundn');
	} else {
		for (let k = 0; k < Number(params.get('windows') ?? 1); k++)
			windows.push(await window(engine, 'shown'));
	}
	const blocks = (await ask(engine, 'blocks', null, 'blocksn')) as number;
	const result = {
		tier: engine.capabilities.tier,
		mode: { ...engine.mode },
		blocks,
		...windows[0],
		windows,
	};
	await engine.destroy();
	return result;
});
