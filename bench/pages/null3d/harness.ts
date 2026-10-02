// Runs a null3d benchmark scene page. The scene itself runs in the sketch worker, built from the
// same shared scene module as the three.js twins. With `?hold`, the engine's hold mode steps the
// scene to the held time and draws that frame on a canvas of the parity size, and the page
// publishes the frame's pixels. With `?demo`, it runs the scene until the page closes. With
// `?soak=`, it runs the scene for that many minutes, measures the engine once a minute, and
// publishes each minute's figures. Otherwise it warms up, measures the engine, and publishes the
// frame metrics. The engine's own switches, such
// as `?gpu=webgpu`, `?latency=low` or `?preset=low`, pick the GPU path, the thread mode and the
// quality preset. `?governor=off` keeps the quality governor off in a scene that turns it on.
import { createEngine, type Engine, type SecondRates } from '@null3d/engine';
import { timedRun } from '../../../packages/cli/src/protocol.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import { CANVAS, MEASURE_SECONDS, PARITY_CANVAS, WARMUP_SECONDS } from '../../scenes/spec';
import { soakEngine } from '../lib/device-soak';
import { fillWindow, fitToWindow, showPageName } from '../lib/fit';
import { pageReport, readRunOptions } from '../lib/options';
import { twinSettings } from '../lib/preset';
import { engineTrace, QualityLog } from '../lib/trace';
import { QUALITY_MESSAGE } from './sketch-common';

/** How a scene's page runs, where it differs from the protocol's page. */
export interface Null3dPageOptions {
	/**
	 * Draw as a full-screen app on a phone does: the canvas fills the window, at the device's pixel
	 * ratio up to the quality preset's cap. The protocol's canvas otherwise has a fixed size at one
	 * device pixel per CSS pixel. Hold mode keeps the parity canvas either way.
	 */
	fillWindow?: boolean;
	/** Record the trace of each measured second: frame rates, render scale and quality steps. */
	trace?: boolean;
}

/**
 * Runs `sketch`, a sketch module next to the page, as the scene `sceneName` with `defaultCount`
 * objects, or with the count `?n=` asks for. A scene built of whole parts passes `wholeCount`, which
 * turns an asked-for count into the count the scene draws. The sketch module reads `n`, `shadows`
 * when the page asks for shadows, and `governor` when the page turns the governor off, from its own
 * address.
 */
export function runNull3dPage(
	sceneName: string,
	sketch: URL,
	defaultCount: number,
	wholeCount: (count: number) => number = (count) => count,
	pageOptions: Null3dPageOptions = {},
): void {
	const params = new URLSearchParams(location.search);
	showPageName();
	run(pageReport(params), async () => {
		const options = readRunOptions(params);
		const held = options.hold !== null;
		const filled = pageOptions.fillWindow === true && !held;
		const size = held ? PARITY_CANVAS : CANVAS;
		const canvas = document.createElement('canvas');
		canvas.style.width = `${size.width}px`;
		canvas.style.height = `${size.height}px`;
		canvas.style.display = 'block';
		document.body.append(canvas);
		if (filled) fillWindow(canvas);
		const sketchUrl = new URL(sketch);
		const n = wholeCount(options.count ?? defaultCount);
		sketchUrl.searchParams.set('n', String(n));
		if (options.shadows !== null) sketchUrl.searchParams.set('shadows', String(options.shadows));
		if (!options.governor) sketchUrl.searchParams.set('governor', 'off');

		// A bare `?hold` holds at the scene's hold time, which the page passes as the engine's option.
		// A page that fills the window leaves the pixel ratio's cap to the quality preset.
		const engine = await createEngine({
			canvas,
			sketch: sketchUrl,
			...(!filled && { maxPixelRatio: CANVAS.pixelRatio }),
			hold: options.hold ?? undefined,
		});
		const log = pageOptions.trace ? new QualityLog() : undefined;
		if (log) engine.onSketchMessage((name, data) => name === QUALITY_MESSAGE && log.add(data));
		if (!filled) fitToWindow(canvas, size.width, size.height);
		const report = {
			scene: sceneName,
			renderer: 'null3d',
			tier: engine.capabilities.tier,
			mode: engine.mode,
			n,
			...(filled && {
				canvas: {
					width: canvas.clientWidth,
					height: canvas.clientHeight,
					pixelRatio: Math.min(devicePixelRatio, twinSettings(engine.mode.preset).maxPixelRatio),
				},
			}),
		};
		// A demo keeps the engine running until the page closes. A tool that watches a long run, such
		// as the soak test, measures the engine through the page.
		if (options.demo) {
			(globalThis as { __null3dEngine?: Engine }).__null3dEngine = engine;
			return report;
		}
		try {
			if (options.soak !== null) return { ...report, soak: await soakEngine(engine, options.soak) };
			if (options.hold !== null) {
				const { width, height, pixels } = await engine.captureFrame();
				return { ...report, width, height, pixels: toBase64(pixels) };
			}
			const measureSeconds = options.seconds ?? MEASURE_SECONDS;
			const timed = await timedRun({
				engine,
				warmupSeconds: options.seconds ?? WARMUP_SECONDS,
				measureSeconds,
			});
			const trace =
				log &&
				engineTrace(
					(timed.stats as { perSecond?: SecondRates[] }).perSecond ?? [],
					log,
					performance.now() - measureSeconds * 1000,
				);
			return { ...report, ...timed, ...(trace && { trace }), userAgent: navigator.userAgent };
		} finally {
			await engine.destroy();
		}
	});
}
