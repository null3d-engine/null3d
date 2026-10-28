// The temporal resolve's cost in the Creek, at 1920 x 1080: the showcase plays with the resolve off
// and on in turns, and the page reports the medians of GPU time per frame. ?gpu= picks the path,
// ?preset= the preset, and ?phone=1 the resolve's cheaper phone path. Run it with a quiet computer,
// as the cost spec does.
import { createEngine, type Engine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const gpu = params.get('gpu') ?? 'webgpu';
const preset = params.get('preset') ?? 'high';
const phone = params.get('phone') === '1';
const SIZE = [1920, 1080] as const;

/** Starts the Creek's engine at the measurement's size and waits for its first frame. */
async function start(): Promise<{ engine: Engine; canvas: HTMLCanvasElement }> {
	const canvas = document.createElement('canvas');
	canvas.width = SIZE[0];
	canvas.height = SIZE[1];
	canvas.style.width = `${SIZE[0]}px`;
	canvas.style.height = `${SIZE[1]}px`;
	document.body.append(canvas);
	const sketch = new URL('./sketches/creek-taa-cost-sketch.ts', import.meta.url);
	sketch.search = phone ? '?phone=1' : '';
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: preset as 'low' | 'medium' | 'high' | 'ultra',
		gpu: gpu as 'webgpu' | 'webgl2',
	});
	await engine.firstFrame;
	return { engine, canvas };
}

/** Waits for the sketch to draw after it changed the resolve. */
function settled(engine: Engine): Promise<void> {
	return new Promise((resolve) => {
		let stop: () => void = () => {};
		stop = engine.onSketchMessage((name) => {
			if (name !== 'settled') return;
			stop();
			resolve();
		});
	});
}

run('taa-creek-cost', async () => {
	const { engine, canvas } = await start();
	const failures: string[] = [];
	engine.onFailure(({ code }) => failures.push(code));
	const { off, on } = await featureCost(engine, async (drawn) => {
		if (!drawn) {
			engine.postToSketch('taa-off', null);
			return;
		}
		const built = settled(engine);
		engine.postToSketch('taa', null);
		await built;
	});
	const tier = engine.capabilities.tier as string;
	const effective = engine.mode.preset as string;
	await engine.destroy();
	canvas.remove();
	return { gpu, phone, tier, preset: effective, off, on, failures };
});
