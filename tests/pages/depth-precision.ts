// Probe: draws variants of the depth precision scene one engine after another, and publishes
// the colors that each frame holds, so a device run shows which surfaces cover what.
import { createEngine } from '@null3d/engine';
import { progress, run, toBase64 } from './lib/result';

const VARIANTS: [string, URL][] = [
	['all', new URL('./sketches/probe/depth-all.ts', import.meta.url)],
	['tie', new URL('./sketches/probe/depth-tie.ts', import.meta.url)],
	['near', new URL('./sketches/probe/depth-near.ts', import.meta.url)],
	['mid', new URL('./sketches/probe/depth-mid.ts', import.meta.url)],
	['t8', new URL('./sketches/probe/depth-t8.ts', import.meta.url)],
	['t9', new URL('./sketches/probe/depth-t9.ts', import.meta.url)],
	['t10', new URL('./sketches/probe/depth-t10.ts', import.meta.url)],
	['back', new URL('./sketches/probe/depth-back.ts', import.meta.url)],
	['front', new URL('./sketches/probe/depth-front.ts', import.meta.url)],
	['plane', new URL('./sketches/probe/depth-plane.ts', import.meta.url)],
	['thick', new URL('./sketches/probe/depth-thick.ts', import.meta.url)],
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

run('depth-precision', async () => {
	const variants: Record<string, unknown> = {};
	const frames: Record<string, string> = {};
	let first:
		| { tier: string; mode: unknown; width: number; height: number; pixels: Uint8Array }
		| undefined;
	for (const [name, sketch] of VARIANTS) {
		const canvas = document.createElement('canvas');
		canvas.style.width = '640px';
		canvas.style.height = '360px';
		document.body.append(canvas);
		try {
			const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
			const frame = await engine.captureFrame();
			await engine.destroy();
			variants[name] = colors(frame.pixels);
			frames[name] = toBase64(frame.pixels);
			progress(`${name}: ${JSON.stringify(variants[name])}`);
			first ??= {
				tier: engine.capabilities.tier,
				mode: engine.mode,
				width: frame.width,
				height: frame.height,
				pixels: frame.pixels,
			};
		} catch (error) {
			variants[name] = `failed: ${(error as Error).message}`;
		}
		canvas.remove();
	}
	if (!first) throw new Error(`every variant failed: ${JSON.stringify(variants)}`);
	return {
		tier: first.tier,
		mode: first.mode,
		variants,
		frames,
		width: first.width,
		height: first.height,
		pixels: toBase64(first.pixels),
	};
});
