// Measures the ocean's frame rate in three states on the GPU tier that the URL names: the transform
// and the surface drawn, the surface drawn with the transform off, and the transform run with no
// surface drawn. Each state is timed in windows of its own, taken in turns, after a warm-up long
// enough for the WebGL2 fragment form to build every program it draws. ?every= sets the reflection's
// cadence for every preset, which holds the pass on so a run can tell a pass toggle's recompile from
// the transform itself.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** The states that the sketch knows, in the order that the page measures them. */
const STATES = ['on', 'off', 'sim'] as const;
/** Seconds of drawing before the first measurement: the WebGL2 form builds a program per pass. */
const WARM_UP = 20;
/** Seconds of each measurement. */
const WINDOW = 4;
/** The turns of each state: an even count, so a clock that drifts does not favour one state. */
const ROUNDS = 2;

/** One state's frame rate, from the frame intervals of its windows. */
interface StateRate {
	name: string;
	/** The middle frame interval of each window, in milliseconds. */
	intervals: number[];
	/** The frame interval of every window taken together, in milliseconds. */
	intervalMs: number;
	/** The frames a second that the middle interval gives. */
	fps: number;
}

/** The middles of a list of numbers. */
function middle(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const at = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[at] as number)
		: ((sorted[at - 1] as number) + (sorted[at] as number)) / 2;
}

run('ocean-rate', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/ocean-rate-sketch.ts', import.meta.url);
	const every = new URLSearchParams(location.search).get('every');
	sketch.search = `?scale=1&fixed${every === null ? '' : `&every=${every}`}`;
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			let stop: () => void = () => {};
			stop = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				stop();
				resolve();
			});
		});
	const windows = new Map<string, number[]>(STATES.map((name) => [name, []]));
	await new Promise((resolve) => setTimeout(resolve, WARM_UP * 1000));
	for (let round = 0; round < ROUNDS; round++) {
		const order = round % 2 === 1 ? [...STATES].reverse() : STATES;
		for (const name of order) {
			engine.postToSketch(name, null);
			await settled();
			const stats = await engine.measure(WINDOW);
			windows.get(name)?.push(stats.intervalMs.median);
		}
	}
	const states: StateRate[] = STATES.map((name) => {
		const intervals = windows.get(name) ?? [];
		const intervalMs = middle(intervals);
		return { name, intervals, intervalMs, fps: 1000 / intervalMs };
	});
	await engine.destroy();
	return { tier: engine.capabilities.tier, warmUp: WARM_UP, window: WINDOW, states };
});
