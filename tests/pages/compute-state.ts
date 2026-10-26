// Runs the sketch that keeps a compute pass's state between runs, with the case that the URL names,
// and reports the texels that it read back and the frames that the reads took. The pass, its
// fallback and its readbacks run on the GPU tier that the URL's switches ask for.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const CASE = params.get('case') ?? 'steps';

/** The fields that the sketch reports when its reads have landed. */
interface StateReport {
	case: string;
	values: number[];
	frames: number;
}

/** The red, green, blue and alpha of one captured pixel. */
type Pixel = [number, number, number, number];

run('compute-state', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL(`./sketches/compute-state-sketch.ts?case=${CASE}`, import.meta.url),
		maxPixelRatio: 1,
	});
	const tier = engine.capabilities.tier;
	const mode = engine.mode;
	const waitMessage = (type: string): Promise<void> =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${CASE}: the sketch sent no "${type}" within 30 s`)),
				30_000,
			);
			const off = engine.onMessage((name) => {
				if (name !== type) return;
				clearTimeout(timer);
				off();
				resolve();
			});
		});
	const pixel = (pixels: Uint8Array, width: number, height: number, x: number): Pixel => {
		const at = (Math.floor(height / 2) * width + Math.floor(x)) * 4;
		return [
			pixels[at] as number,
			pixels[at + 1] as number,
			pixels[at + 2] as number,
			pixels[at + 3] as number,
		];
	};
	if (CASE === 'kept') {
		await waitMessage('running');
		const before = await engine.captureFrame();
		engine.postMessage('stop');
		await waitMessage('stopped');
		// A few frames pass with the pass switched off.
		await new Promise((resolve) => setTimeout(resolve, 250));
		const after = await engine.captureFrame();
		const left = pixel(before.pixels, before.width, before.height, before.width * 0.25);
		const right = pixel(before.pixels, before.width, before.height, before.width * 0.75);
		const leftAfter = pixel(after.pixels, after.width, after.height, after.width * 0.25);
		const rightAfter = pixel(after.pixels, after.width, after.height, after.width * 0.75);
		const same = [...left, ...right].every(
			(value, index) => Math.abs(value - ([...leftAfter, ...rightAfter][index] as number)) <= 2,
		);
		await engine.destroy();
		return { tier, mode, case: CASE, left, right, same };
	}
	const state = await new Promise<StateReport>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${CASE}: the sketch reported no state within 30 s`)),
			30_000,
		);
		const off = engine.onMessage((type, data) => {
			if (type !== 'state') return;
			clearTimeout(timer);
			off();
			resolve(data as StateReport);
		});
	});
	await engine.destroy();
	return { tier, mode, ...state };
});
