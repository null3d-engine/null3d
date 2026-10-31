// Measures how long the bark and the leaf atlas take to paint on this device, separately:
// tests/pages/sketches/atlas-paint-cost-sketch.ts paints each in turn for ?rounds= rounds, three
// by default, and posts every round's times with the middle figure of each. The painters are the
// ones that bakePlantAtlases runs. The device runner's atlas-paint plan runs it on each device.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const rounds = Math.max(1, Math.floor(Number(params.get('rounds') ?? '3')));

run('atlas-paint-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/atlas-paint-cost-sketch.ts', import.meta.url);
	sketch.search = `?rounds=${rounds}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	progress('the first frame drew');
	const painted = new Promise<Record<string, unknown>>((resolve) => {
		const stop = engine.onSketchMessage((name, data) => {
			if (name !== 'painted') return;
			stop();
			resolve(data as Record<string, unknown>);
		});
		engine.postToSketch('paint', null);
	});
	const result = await painted;
	const tiers = {
		tier: engine.capabilities.tier,
		window: [innerWidth, innerHeight] as const,
		devicePixelRatio,
	};
	await engine.destroy();
	return { ...tiers, rounds, failures, ...result };
});
