// Drives the frame-budget governor with a load that the page switches, and reports what it does to
// the wind at one preset: the light phase draws no cards, the heavy phase draws them all until the
// governor steps, and the settle phase takes them away so the governor steps back. The camera
// stands still, so the pixels that change between two heavy-phase frames are the air moving the
// cards. Open it with ?gpu= and ?preset=; ?cards= sets the load.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const preset = params.get('preset') ?? 'medium';
const cards = Number(params.get('cards') ?? '400000');

/** The sketch's reading of the governor and the wind's resolved settings. */
interface StressState {
	steps: number;
	scale: number;
	preset: string;
	layer: number;
	settings: Readonly<Record<string, number | string>>;
}

/** One phase of the run. */
interface Phase {
	/** The governor's steps, the render scale and the wind's settings after the phase's wait. */
	state: StressState | null;
	/** The frame interval and CPU time, where the device times the frame. */
	frame: { interval: number; cpu: number; gpu: number | null };
}

const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** The share of channels that differ by more than `step` between two frames. */
function changed(a: Uint8Array, b: Uint8Array, step: number): number {
	let count = 0;
	const channels = Math.min(a.length, b.length);
	for (let k = 0; k < channels; k++)
		if (Math.abs((a[k] as number) - (b[k] as number)) > step) count++;
	return channels === 0 ? 0 : count / channels;
}

run('wind-stress', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/wind-stress-sketch.ts', import.meta.url);
	sketch.search = `?cards=${cards}&preset=${preset}`;
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.message));
	await engine.firstFrame;

	const read = (): Promise<StressState | null> =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'state') return;
				off();
				resolve(data as StressState);
			});
			engine.postToSketch('read');
		});
	const setLoad = (count: number): void => engine.postToSketch('load', { count });
	const measure = async (seconds: number): Promise<Phase['frame']> => {
		const stats: FrameMetrics = await engine.measure(seconds);
		return {
			interval: stats.intervalMs.median,
			cpu: stats.cpuMs.median,
			gpu: stats.gpuMs?.median ?? null,
		};
	};
	const phase = async (
		load: number,
		settleSeconds: number,
		measureSeconds: number,
	): Promise<Phase> => {
		setLoad(load);
		await wait(settleSeconds);
		const reading = await read();
		const frame = await measure(measureSeconds);
		return { state: reading, frame };
	};

	// The light phase keeps the budget, the heavy one overloads it until the governor steps, and
	// the settle phase asks whether it comes back.
	const light = await phase(0, 1.5, 2);
	const heavy = await phase(cards, 4, 3);
	// The governor may step further down while the heavy frames queue, so the deepest state is the
	// one to beat on the way back up.
	const bottom = await read();
	// Two frames 300 ms apart: only the air can move a still camera's cards.
	const first = await engine.captureFrame();
	await wait(0.3);
	const second = await engine.captureFrame();
	const moved = changed(first.pixels, second.pixels, 8);
	const settle = await phase(0, 20, 2);

	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		requested: preset,
		preset: light.state?.preset ?? preset,
		cards,
		maxInstances: engine.capabilities.maxInstances,
		light,
		heavy,
		bottom,
		settle,
		moved,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		failures,
	};
});
