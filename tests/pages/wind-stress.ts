// Drives the frame-budget governor with a load that the page switches, and reports what it does to
// the wind at one preset: the light phase draws no cards, the heavy phase draws them all until the
// governor steps, and the settle phase takes them away so the governor steps back. The camera
// stands still, so the pixels that change between two heavy-phase frames are the air moving the
// cards. Open it with ?gpu= and ?preset=; ?cards= sets the load.
import { createEngine, type FrameMetrics, type QualityPreset } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const wanted = params.get('preset');
/** The preset that the page asks for, which the engine caps at the path's highest. */
const preset = (wanted ?? 'auto') as 'auto' | QualityPreset;
const cards = Number(params.get('cards') ?? '400000');
/** The cards that stand during the motion reading, which the capture can read on every device. */
const MOTION_CARDS = 10000;

/** The sketch's reading of the governor and the wind's resolved settings. */
interface StressState {
	/** The engine governor's steps past the render scale. */
	steps: number;
	/** The wind's share of its own budget, from its floor to 1. */
	budgetScale: number;
	budgetMs: number;
	allowedMs: number;
	renderScale: number;
	preset: string;
	layer: number;
	/** The load that the device's instance limit allowed. */
	cards: number;
	maxInstances: number;
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
	sketch.search = `?cards=${cards}`;
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1, preset });
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

	// The card material's pipelines build on its first drawn frame, and a capture waits for the
	// frame's pipelines. A tablet cannot build them under the full load within that wait, so a few
	// cards draw first and a capture builds them.
	const warmUp = async (): Promise<string> => {
		setLoad(256);
		await wait(1.5);
		const outcome = await engine.captureFrame().then(
			() => 'ok',
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
		setLoad(0);
		await wait(0.5);
		return outcome;
	};
	const warmUpCapture = await warmUp();

	// The light phase keeps the budget, the heavy one overloads it until the governor steps, and
	// the settle phase asks whether it comes back.
	const light = await phase(0, 1.5, 2);
	const heavy = await phase(cards, 4, 3);
	// The governor may step further down while the heavy frames queue, so the deepest state is the
	// one to beat on the way back up.
	const bottom = await read();
	// The full load's first frames build the card material's pipelines for every cascade, and a
	// tablet does not finish them within the capture's wait. The motion reading therefore runs at a
	// light load, with the governor still at its deepest step: two frames a second apart, so only
	// the air can move a still camera's cards. A device that cannot capture says why.
	setLoad(MOTION_CARDS);
	await wait(1.5);
	let moved = 0;
	let captureError: string | undefined;
	try {
		const first = await engine.captureFrame();
		await wait(1);
		const second = await engine.captureFrame();
		moved = changed(first.pixels, second.pixels, 8);
	} catch (error) {
		captureError = error instanceof Error ? error.message : String(error);
	}
	// The settings read beside the captures show the governor stayed stepped for them.
	const stepping = await read();
	const settle = await phase(0, 20, 2);

	const { tier, maxInstances } = engine.capabilities;
	await engine.destroy();
	return {
		tier,
		requested: preset,
		preset: light.state?.preset ?? preset,
		cards: light.state?.cards ?? cards,
		maxInstances: light.state?.maxInstances ?? maxInstances,
		light,
		heavy,
		bottom,
		stepping,
		settle,
		moved,
		warmUpCapture,
		...(captureError === undefined ? {} : { captureError }),
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		failures,
	};
});
