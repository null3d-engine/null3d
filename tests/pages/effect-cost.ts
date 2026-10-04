// Measures what an effect costs on this device: ?effect=bloom (the default) or ?effect=ao names
// it. The effect's scene fills the window at the render scale that ?scale= fixes, 1 by default,
// with the governor off. After a warm-up, the page measures play with the effect off and on in
// turns, ROUNDS times each, and reports the medians of each side's GPU time per frame, where the
// device has a GPU timer, and of its frame interval and CPU time. The device runner's bloom and ao
// plans run it on each GPU path at the scales of 1 and 0.5.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** Seconds of play before the first measurement. */
const WARM_UP_SECONDS = 2;
/** Seconds of each measurement, and how many each side gets. */
const SECONDS = 2;
const ROUNDS = 3;

/**
 * Each effect's sketch, which turns the effect on at the message of the effect's name, posts
 * 'settled' once its pipelines are built, and turns it off at the name followed by '-off'.
 */
const SKETCHES = {
	bloom: './sketches/bloom-sketch.ts',
	ao: './sketches/ao-sketch.ts',
} as const;

type Effect = keyof typeof SKETCHES;

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const asked = params.get('effect') ?? 'bloom';
if (!Object.hasOwn(SKETCHES, asked)) throw new Error(`the page measures no effect ${asked}`);
const effect = asked as Effect;

/** The middle of some numbers, or null without any. */
function median(values: number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

run('effect-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL(SKETCHES[effect], import.meta.url);
	// Prototype P2: the bloom method and the mip chain's base rows reach the sketch.
	const method =
		params.get('method') === 'mip' ? `&method=mip&base=${params.get('base') ?? 512}` : '';
	sketch.search = `?scale=${scale}${method}&fixed`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				off();
				resolve();
			});
		});
	await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
	const sides = {
		off: { gpuMs: [] as number[], intervalMs: [] as number[], cpuMs: [] as number[] },
		on: { gpuMs: [] as number[], intervalMs: [] as number[], cpuMs: [] as number[] },
	};
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			if (side === 'on') {
				const built = settled();
				engine.postToSketch(effect, null);
				await built;
			} else engine.postToSketch(`${effect}-off`, null);
			const stats = await engine.measure(SECONDS);
			if (stats.gpuMs) sides[side].gpuMs.push(stats.gpuMs.median);
			sides[side].intervalMs.push(stats.intervalMs.median);
			sides[side].cpuMs.push(stats.cpuMs.median);
		}
	}
	await engine.destroy();
	const summary = (side: 'off' | 'on') => ({
		gpuMs: median(sides[side].gpuMs),
		intervalMs: median(sides[side].intervalMs),
		cpuMs: median(sides[side].cpuMs),
	});
	return {
		effect,
		method: params.get('method') ?? 'unreal',
		base: params.get('base'),
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		// The window in CSS pixels and the screen's pixel ratio: the preset's cap on the ratio sets
		// the drawing buffer's size from them.
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off: summary('off'),
		on: summary('on'),
		failures,
	};
});
