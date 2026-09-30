// Runs a null3d benchmark scene page. The scene itself runs in the sketch worker, built from the
// same shared scene module as the three.js twins. With `?hold`, the engine's hold mode steps the
// scene to the held time and draws that frame on a canvas of the parity size, and the page
// publishes the frame's pixels. With `?demo`, it runs the scene until the page closes. Otherwise it
// warms up, measures the engine, and publishes the frame metrics. The engine's own switches, such
// as `?gpu=webgpu` or `?latency=low`, pick the GPU path and the thread mode.
import { createEngine, type Engine } from '@null3d/engine';
import { timedRun } from '../../../packages/cli/src/protocol.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import { CANVAS, MEASURE_SECONDS, PARITY_CANVAS, WARMUP_SECONDS } from '../../scenes/spec';
import { fitToWindow, showPageName } from '../lib/fit';
import { pageReport, readRunOptions } from '../lib/options';

/**
 * Runs `sketch`, a sketch module next to the page, as the scene `sceneName` with `defaultCount`
 * objects, or with the count `?n=` asks for. A scene built of whole parts passes `wholeCount`, which
 * turns an asked-for count into the count the scene draws. The sketch module reads `n`, and
 * `shadows` when the page asks for shadows, from its own address.
 */
export function runNull3dPage(
	sceneName: string,
	sketch: URL,
	defaultCount: number,
	wholeCount: (count: number) => number = (count) => count,
): void {
	const params = new URLSearchParams(location.search);
	showPageName();
	run(pageReport(params), async () => {
		const options = readRunOptions(params);
		const size = options.hold !== null ? PARITY_CANVAS : CANVAS;
		const canvas = document.createElement('canvas');
		canvas.style.width = `${size.width}px`;
		canvas.style.height = `${size.height}px`;
		canvas.style.display = 'block';
		document.body.append(canvas);
		const sketchUrl = new URL(sketch);
		const n = wholeCount(options.count ?? defaultCount);
		sketchUrl.searchParams.set('n', String(n));
		if (options.shadows !== null) sketchUrl.searchParams.set('shadows', String(options.shadows));

		// A bare `?hold` holds at the scene's hold time, which the page passes as the engine's option.
		const engine = await createEngine({
			canvas,
			sketch: sketchUrl,
			maxPixelRatio: CANVAS.pixelRatio,
			hold: options.hold ?? undefined,
		});
		fitToWindow(canvas, size.width, size.height);
		const report = {
			scene: sceneName,
			renderer: 'null3d',
			tier: engine.capabilities.tier,
			mode: engine.mode,
			n,
		};
		// A demo keeps the engine running until the page closes. A tool that watches a long run, such
		// as the soak test, measures the engine through the page.
		if (options.demo) {
			(globalThis as { __null3dEngine?: Engine }).__null3dEngine = engine;
			return report;
		}
		try {
			if (options.hold !== null) {
				const { width, height, pixels } = await engine.captureFrame();
				return { ...report, width, height, pixels: toBase64(pixels) };
			}
			const timed = await timedRun({
				engine,
				warmupSeconds: options.seconds ?? WARMUP_SECONDS,
				measureSeconds: options.seconds ?? MEASURE_SECONDS,
			});
			return { ...report, ...timed, userAgent: navigator.userAgent };
		} finally {
			await engine.destroy();
		}
	});
}
