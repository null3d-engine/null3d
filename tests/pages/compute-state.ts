// Runs the sketch that keeps a compute pass's state between runs, with the case that the URL names,
// and reports the texels that it read back and the frames that the reads took. The pass, its
// fallback and its readbacks run on the GPU tier that the URL's switches ask for.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const CASE = params.get('case') ?? 'steps';

/** The fields that the sketch reports when its reads have landed. */
interface StateReport {
	case: string;
	values: number[];
	frames: number;
	/** Milliseconds that the read call took to return, for the slow-frame case. */
	callMs?: number;
	/** The four numbers of each texel of a region read, top row first. */
	texels?: number[];
}

/** The red, green, blue and alpha of one captured pixel. */
type Pixel = [number, number, number, number];

run('compute-state', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The build rewrites the static address of the sketch module, so the case goes on afterwards.
	const sketch = new URL('./sketches/compute-state-sketch.ts', import.meta.url);
	sketch.searchParams.set('case', CASE);
	const engine = await createEngine({
		canvas,
		sketch,
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
			const off = engine.onSketchMessage((name) => {
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
	if (CASE === 'cost') {
		// The sketch starts 40 runs a frame and asks for the frame probe, which measures them. The
		// same measurement runs again with the pass switched off, so the pass's own cost shows.
		const measureWhen = (
			message: string,
		): Promise<{ metrics: FrameMetrics; format: string | undefined }> =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error(`the sketch sent no "${message}" within 30 s`)),
					30_000,
				);
				const off = engine.onSketchMessage((name, data) => {
					if (name !== message) return;
					clearTimeout(timer);
					off();
					void engine
						.measure(3)
						.then(
							(metrics) =>
								resolve({ metrics, format: (data as { format?: string } | undefined)?.format }),
							reject,
						);
				});
			});
		const figures = ({ metrics, format }: { metrics: FrameMetrics; format?: string }) => ({
			frames: metrics.frames,
			seconds: metrics.seconds,
			interval: metrics.intervalMs.median,
			cpu: metrics.cpuMs.median,
			gpu: metrics.gpuMs?.median ?? null,
			format: format ?? null,
		});
		const on = await measureWhen('measuring');
		engine.postToSketch('baseline');
		const off = await measureWhen('measuring-off');
		// The compute paths hold the target's two blocks and two state textures, both rgba16float;
		// WebGL2 holds the target's two and one scratch, in the scene color's format.
		const texel = tier === 'webgl2' ? (on.format === 'rgba16float' ? 8 : 4) : 8;
		const copies = tier === 'webgl2' ? 3 : 4;
		await engine.destroy();
		return {
			tier,
			mode,
			case: CASE,
			on: figures(on),
			off: figures(off),
			passBytes: 256 * 256 * copies * texel,
		};
	}
	if (CASE === 'kept' || CASE === 'fs-kept') {
		await waitMessage('running');
		const before = await engine.captureFrame();
		engine.postToSketch('stop');
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
	if (CASE === 'loss') {
		// The sketch asks for the loss once it has read a value; the engine rebuilds every texture.
		const off = engine.onSketchMessage((name) => {
			if (name !== 'lose') return;
			off();
			engine.simulateGpuLoss();
			setTimeout(() => engine.postToSketch('lost'), 1500);
		});
	}
	const state = await new Promise<StateReport>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${CASE}: the sketch reported no state within 30 s`)),
			30_000,
		);
		const off = engine.onSketchMessage((type, data) => {
			if (type !== 'state') return;
			clearTimeout(timer);
			off();
			resolve(data as StateReport);
		});
	});
	await engine.destroy();
	return { tier, mode, ...state };
});
