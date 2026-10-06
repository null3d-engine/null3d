// Probe: runs the texture array scene with several texture counts and upload budgets, one engine
// after another, and publishes the colors of each captured frame.
import { createEngine } from '@null3d/engine';
import { progress, run, toBase64 } from './lib/result';

const VARIANTS: [string, { count: number; budget: number }][] = [
	['c1', { count: 1, budget: 1 << 20 }],
	['c4', { count: 4, budget: 1 << 20 }],
	['c5', { count: 5, budget: 1 << 20 }],
	['c8', { count: 8, budget: 1 << 20 }],
	['c50', { count: 50, budget: 1 << 20 }],
	['c4-small', { count: 4, budget: 2048 }],
	['c50-small', { count: 50, budget: 2048 }],
];

/** The most common colors of a frame, with their pixel counts. */
function colors(rgba: Uint8Array): [string, number][] {
	const counts = new Map<string, number>();
	for (let at = 0; at < rgba.length; at += 4) {
		const key = `${rgba[at]},${rgba[at + 1]},${rgba[at + 2]},${rgba[at + 3]}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

run('texture-arrays', async () => {
	const variants: Record<string, unknown> = {};
	const frames: Record<string, string> = {};
	let last:
		| { tier: string; mode: unknown; width: number; height: number; pixels: Uint8Array }
		| undefined;
	for (const [name, settings] of VARIANTS) {
		const canvas = document.createElement('canvas');
		canvas.style.width = '400px';
		canvas.style.height = '240px';
		document.body.append(canvas);
		try {
			const engine = await createEngine({
				canvas,
				sketch: new URL('./sketches/texture-arrays-sketch.ts', import.meta.url),
				maxPixelRatio: 1,
			});
			const loaded = new Promise<void>((resolve) =>
				engine.onSketchMessage((type) => {
					if (type === 'loaded') resolve();
				}),
			);
			engine.postToSketch('start', settings);
			await Promise.race([loaded, wait(15_000)]);
			await wait(300);
			const before = await engine.captureFrame();
			await wait(300);
			const after = await engine.captureFrame();
			await engine.destroy();
			variants[name] = { first: colors(before.pixels), second: colors(after.pixels) };
			frames[name] = toBase64(after.pixels);
			progress(`${name}: ${JSON.stringify(variants[name])}`);
			last = {
				tier: engine.capabilities.tier,
				mode: engine.mode,
				width: after.width,
				height: after.height,
				pixels: after.pixels,
			};
		} catch (error) {
			variants[name] = `failed: ${(error as Error).message}`;
			progress(`${name}: failed: ${(error as Error).message}`);
		}
		canvas.remove();
	}
	if (!last) throw new Error(`every variant failed: ${JSON.stringify(variants)}`);
	return { ...last, pixels: toBase64(last.pixels), variants, frames };
});
