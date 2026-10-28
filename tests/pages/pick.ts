// Opens the pick scene and publishes which object each probe pixel shows, and what a raycast at
// the mask's hole finds. The engine picks on the GPU where every source has a pick build, so a
// masked card answers by its mask and the pixel under the pointer decides.
import { createEngine, type Engine } from '@null3d/engine';
import { run } from './lib/result';

interface PickAnswer {
	name: string;
	expect: string | null;
	got: string | null;
}

interface PickResult {
	answers: PickAnswer[];
	/** What a raycast at the card's hole finds, which is the card because rays ignore masks. */
	raysCard: string | null;
}

/** What a pick did after the page took the GPU away while its read was in flight. */
interface PickLoss {
	/** True when the pick's promise settled before the page's bound. */
	settled: boolean;
	/** The pick's answer, or the error that rejected it. */
	outcome?: string;
	/** How long the pick waited after its read went out, in milliseconds. */
	elapsedMs?: number;
}

/** How long a pick may wait after the GPU is lost before the page calls it unsettled. */
const LOSS_BOUND_MS = 20_000;

/** How long one measurement waits while the page waits for the new device, in seconds. */
const RECOVERY_POLL_S = 0.1;

/**
 * Resolves once the engine has replaced the lost device: the count of GPU losses rises when the new
 * device starts. The engine is paused meanwhile, so the count covers the loss and no frames.
 */
async function waitForNewDevice(engine: Engine, deadline: number): Promise<void> {
	while (performance.now() < deadline) {
		if ((await engine.measure(RECOVERY_POLL_S)).gpuLosses > 0) return;
	}
}

/**
 * Asks the sketch for one more pick, takes the GPU away while it waits for its read, and waits for
 * the promise to settle. The engine starts a new device, but it cannot finish a read that the old
 * one recorded, so the pick must reject rather than wait forever.
 *
 * The engine is paused around the loss for order. The pick is recorded for the old device before
 * the loss, and no frame draws it; the engine resumes only after the new device starts, so the
 * pick's first poll sees the new GPU epoch and rejects.
 */
function lossWhilePicking(engine: Engine): Promise<PickLoss> {
	return new Promise((resolve) => {
		let started = 0;
		const timer = setTimeout(() => resolve({ settled: false }), LOSS_BOUND_MS);
		const off = engine.onSketchMessage((name, data) => {
			if (name === 'pick-in-flight') {
				started = performance.now();
				engine.simulateGpuLoss();
				void waitForNewDevice(engine, started + LOSS_BOUND_MS - 1000).then(() =>
					engine.setPaused(false),
				);
			} else if (name === 'pick-settled') {
				clearTimeout(timer);
				off();
				resolve({
					settled: true,
					outcome: (data as { outcome: string }).outcome,
					elapsedMs: performance.now() - started,
				});
			}
		});
		// No frame may draw the pick before the loss: a read that the old device finished would
		// answer it, and the test would not see the loss at all.
		engine.setPaused(true);
		engine.postToSketch('pick-loss');
	});
}

run('pick', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/pick-sketch.ts', import.meta.url);
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const mode = { ...engine.mode };
	const picks = await new Promise<PickResult>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'picks') resolve(data as PickResult);
		});
	});
	const loss = new URL(location.href).searchParams.has('lose-gpu')
		? await lossWhilePicking(engine)
		: undefined;
	await engine.destroy();
	return { picks, failures, mode, loss };
});
