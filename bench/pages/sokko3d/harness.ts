// Runs a sokko3d benchmark scene page. The scene itself runs in the game worker, built from the
// same shared scene module as the three.js twins. With `?hold`, the page draws the scene at the
// held time on a canvas of the parity size and publishes the captured pixels. With `?demo`, it runs
// the scene until the page closes. Otherwise it warms up, measures the engine, and publishes the
// frame metrics. The engine's own switches, such as `?gpu=webgpu` or `?latency=low`, pick the GPU
// path and the thread mode.
import { createEngine } from '@sokko3d/engine';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import { CANVAS, MEASURE_SECONDS, PARITY_CANVAS, WARMUP_SECONDS } from '../../scenes/spec';
import { pageReport, readRunOptions } from '../lib/options';

/** Time a hold page lets the engine draw before it captures, so the frame is complete. */
const HOLD_SETTLE_SECONDS = 0.5;

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * Runs `game`, a game module next to the page, as the scene `sceneName` with `defaultCount`
 * objects, or with the count `?n=` asks for when the scene's count is not fixed. The game module
 * reads `n` and `holdMs` from its own address.
 */
export function runSokko3dPage(
	sceneName: string,
	game: URL,
	defaultCount: number,
	fixedCount = false,
): void {
	const params = new URLSearchParams(location.search);
	run(pageReport(params), async () => {
		const options = readRunOptions(params);
		const size = options.hold !== null ? PARITY_CANVAS : CANVAS;
		const canvas = document.createElement('canvas');
		canvas.style.width = `${size.width}px`;
		canvas.style.height = `${size.height}px`;
		canvas.style.display = 'block';
		document.body.prepend(canvas);
		const gameUrl = new URL(game);
		const n = fixedCount ? defaultCount : (options.count ?? defaultCount);
		gameUrl.searchParams.set('n', String(n));
		// Whole milliseconds: the dev server would read a decimal number at the end of the module's
		// address as its file extension.
		if (options.hold !== null)
			gameUrl.searchParams.set('holdMs', String(Math.round(options.hold * 1000)));

		const engine = await createEngine({ canvas, game: gameUrl, maxPixelRatio: CANVAS.pixelRatio });
		const report = {
			scene: sceneName,
			renderer: 'sokko3d',
			tier: engine.capabilities.tier,
			mode: engine.mode,
			n,
		};
		// A demo keeps the engine running until the page closes.
		if (options.demo) return report;
		try {
			if (options.hold !== null) {
				await sleep(HOLD_SETTLE_SECONDS);
				const { width, height, pixels } = await engine.captureFrame();
				return { ...report, width, height, pixels: toBase64(pixels) };
			}
			await sleep(options.seconds ?? WARMUP_SECONDS);
			const stats = await engine.measure(options.seconds ?? MEASURE_SECONDS);
			return {
				...report,
				frames: stats.frames,
				cpuMs: stats.cpuMs,
				intervalMs: stats.intervalMs,
				stats,
				userAgent: navigator.userAgent,
			};
		} finally {
			engine.destroy();
		}
	});
}
