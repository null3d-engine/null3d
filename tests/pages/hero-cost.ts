// Measures what the sun's hero shadow costs on this device: the hero demo's car and yard of
// tests/pages/sketches/hero-cost-sketch.ts, timed with the hero off and on in turns. With ?moving
// the car crosses the pad in every frame, so the hero's tile draws in every frame and the figures
// show its pass; without it the car stands still and the tile rests, so the figures show only what
// a receiver near the hero pays. After a warm-up, the page measures play with the hero off and on,
// in turns, three times each, and reports the medians of each side's GPU time per frame, where the
// device has a GPU timer, and of its frame interval and CPU time, with each thread's. Open it with
// ?gpu= and ?preset= for each path and preset.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const moving = params.has('moving');
const scale = params.get('scale') ?? '1';
const tile = params.get('tile') ?? '';

run('hero-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/hero-cost-sketch.ts', import.meta.url);
	sketch.search = `?fixed&scale=${scale}${moving ? '&moving' : ''}${tile ? `&tile=${tile}` : ''}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<string>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'settled') return;
				off();
				resolve(typeof data === 'string' ? data : '');
			});
		});
	let preset = '';
	const { off, on } = await featureCost(
		engine,
		async (drawn) => {
			const built = settled();
			engine.postToSketch(drawn ? 'hero' : 'hero-off', null);
			preset = await built;
		},
		undefined,
		// Four rounds, in the opposite order on alternate rounds, so a clock that ramps during the
		// run does not make either side look cheaper.
		{ alternate: true, rounds: 4 },
	);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		preset,
		tile: tile ? Number(tile) : 0,
		moving,
		scale: Number(scale),
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
