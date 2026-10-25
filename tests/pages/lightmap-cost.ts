// Measures what a directional light map costs on this device: the curtain of lit quads of
// tests/pages/sketches/lightmap-cost-sketch.ts, drawn with a plain light map and with one that also
// stores the bake's direction, in turns. Both sides shade the same pixels of the same geometry with
// the same radiance and the same normal map, so their difference is the direction texture's read and
// the arithmetic that bends the baked light with the normal. Before the timing, the page draws one
// frame of each side and reports the share of pixels that moved past a few steps, which proves the
// engine kept the direction: a direction texture in another array than the radiance's leaves the
// light map plain, and the two frames then match. After a warm-up, the page measures play with the
// direction off and on, in turns, three times each, and reports the medians of each side's GPU time
// per frame, where the device has a GPU timer, of its frame interval and CPU time, and of each
// thread's. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

/** How far one channel of a pixel must move for the two sides to count as different, of 255. */
const STEPS = 4;

run('lightmap-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/lightmap-cost-sketch.ts', import.meta.url);
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
	const setDirection = async (directional: boolean) => {
		const built = settled();
		engine.postToSketch(directional ? 'direction' : 'direction-off', null);
		await built;
	};
	// The two sides must draw differently. A direction texture that the engine dropped leaves the
	// light map plain, and the two frames would then match to the byte.
	const changedShare = (before: Uint8Array, after: Uint8Array): number => {
		let changed = 0;
		for (let at = 0; at < before.length; at += 4) {
			if (
				Math.abs((before[at] as number) - (after[at] as number)) > STEPS ||
				Math.abs((before[at + 1] as number) - (after[at + 1] as number)) > STEPS ||
				Math.abs((before[at + 2] as number) - (after[at + 2] as number)) > STEPS
			)
				changed++;
		}
		return changed / (before.length / 4);
	};
	// The two pictures live in this call alone, so the frames that are timed hold no copy of them.
	const measureDirectionShare = async (): Promise<number> => {
		await setDirection(false);
		const plain = await engine.captureFrame();
		await setDirection(true);
		const directional = await engine.captureFrame();
		return changedShare(plain.pixels, directional.pixels);
	};
	const directionShare = await measureDirectionShare();
	const { off, on } = await featureCost(engine, setDirection);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		directionShare,
		off,
		on,
		failures,
	};
});
