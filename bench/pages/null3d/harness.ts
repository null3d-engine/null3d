// Runs a null3d benchmark scene page. The scene itself runs in the sketch worker, built from the
// same shared scene module as the three.js twins. With `?hold`, the engine's hold mode steps the
// scene to the held time and draws that frame on a canvas of the parity size, and the page
// publishes the frame's pixels. With `?demo`, it runs the scene until the page closes. With
// `?soak=`, it runs the scene for that many minutes, measures the engine once a minute, and
// publishes each minute's figures. Otherwise it warms up, measures the engine, and publishes the
// frame metrics, and with `?capture`, a PNG file of the frame after the measured seconds, in
// base64, so people can see what the device drew at full speed. The engine's own switches, such
// as `?gpu=webgpu`, `?latency=low` or `?preset=low`, pick the GPU path, the thread mode and the
// quality preset. `?governor=off` keeps the quality governor off in a scene that turns it on.
import { createEngine, type Engine, type SecondRates } from '@null3d/engine';
import { timedRun } from '../../../packages/cli/src/protocol.js';
import {
	GL_TIMING_CHANNEL,
	GL_TIMING_REQUEST,
	type GlTimingReport,
} from '../../../packages/engine/src/gpu/webgl2/call-timing';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import { CANVAS, MEASURE_SECONDS, PARITY_CANVAS, WARMUP_SECONDS } from '../../scenes/spec';
import { soakEngine } from '../lib/device-soak';
import { fillWindow, fitToWindow, showPageName } from '../lib/fit';
import type { GlTiming } from '../lib/gl-timing';
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
 * The page's switches that reach the sketch module's address as they are: `blend` makes S1's
 * boxes see through, `animated` adds that many animated characters to S1, `morphed` adds that
 * many morphed spheres whose weights change every frame, `grading` gives S1 a
 * color grading table and the vignette, `sprites` draws S1's swarm as sprites, `lines` draws it
 * as dashed line segments, `ao` turns ambient occlusion on in S1, `bloom` turns bloom on in S1,
 * `outline` adds outlined boxes to S1, `labels` adds that many labeled objects to S1, whose
 * elements the page binds, `tileShadows` adds spot and point lights that cast shadows to S1, with
 * point light shadows on, and `environment` lights S1 with the built-in room, which turns every
 * frame.
 */
const SKETCH_SWITCHES = [
	'blend',
	'animated',
	'morphed',
	'grading',
	'sprites',
	'lines',
	'ao',
	'bloom',
	'outline',
	'labels',
	'tileShadows',
	'environment',
] as const;

/**
 * Runs `sketch`, a sketch module next to the page, as the scene `sceneName` with `defaultCount`
 * objects, or with the count `?n=` asks for. A scene built of whole parts passes `wholeCount`, which
 * turns an asked-for count into the count the scene draws. The sketch module reads `n`, `shadows`
 * and `far` when the page asks for them, `governor` when the page turns the governor off, and the
 * page's `SKETCH_SWITCHES`, from its own address.
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
		if (options.far !== null) sketchUrl.searchParams.set('far', String(options.far));
		if (options.shadowFilter !== null)
			sketchUrl.searchParams.set('shadowFilter', String(options.shadowFilter));
		if (options.shadowCascadeBlend !== null)
			sketchUrl.searchParams.set('shadowCascadeBlend', String(options.shadowCascadeBlend));
		if (!options.governor) sketchUrl.searchParams.set('governor', 'off');
		// S4's shading switches, which measure what each part of its shading costs per pixel.
		if (options.material !== null) sketchUrl.searchParams.set('material', options.material);
		if (!options.sunShadows) sketchUrl.searchParams.set('sunShadows', 'off');
		if (!options.pointLights) sketchUrl.searchParams.set('pointLights', 'off');
		// A scene with a playable demo, such as S5, reads `demo` to take the user's input.
		if (options.demo) sketchUrl.searchParams.set('demo', '');
		// The allocation check's switches, which only some sketches read.
		for (const name of SKETCH_SWITCHES) {
			const value = params.get(name);
			if (value !== null) sketchUrl.searchParams.set(name, value);
		}

		// A bare `?hold` holds at the scene's hold time, which the page passes as the engine's option.
		// A page that fills the window leaves the pixel ratio's cap to the quality preset, unless
		// `?maxPixelRatio=` names one.
		const engine = await createEngine({
			canvas,
			sketch: sketchUrl,
			...(!filled && { maxPixelRatio: CANVAS.pixelRatio }),
			...(filled && options.maxPixelRatio !== null && { maxPixelRatio: options.maxPixelRatio }),
			antialias: options.antialias ?? undefined,
			shadowCascades: options.shadowCascades ?? undefined,
			shadowMapSize: options.shadowMapSize ?? undefined,
			...(params.has('tileShadows') && { pointLightShadows: true, shadowTiles: 24 }),
			hold: options.hold ?? undefined,
		});
		bindLabels(engine, Number(params.get('labels') ?? 0));
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
					pixelRatio: Math.min(
						devicePixelRatio,
						options.maxPixelRatio ?? twinSettings(engine.mode.preset).maxPixelRatio,
					),
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
			// The warm-up counts from the first frame. A start that takes the stored result of an
			// earlier preset check resolves before its first frame, and a first visit only after it.
			await firstFrameOrFailure(engine);
			const timed = await timedRun({
				engine,
				warmupSeconds: options.seconds ?? WARMUP_SECONDS,
				measureSeconds,
			});
			const glTiming = params.has('gl-timing') ? await requestGlTiming() : undefined;
			const trace =
				log &&
				engineTrace(
					(timed.stats as { perSecond?: SecondRates[] }).perSecond ?? [],
					log,
					performance.now() - measureSeconds * 1000,
				);
			// After the measured seconds, so the capture's readback and encoding cost no measured frame.
			const frame = params.has('capture')
				? toBase64(new Uint8Array(await (await engine.capture()).arrayBuffer()))
				: undefined;
			return {
				...report,
				...timed,
				...(trace && { trace }),
				...(frame && { frame }),
				...(glTiming && { glTiming }),
				userAgent: navigator.userAgent,
			};
		} finally {
			await engine.destroy();
		}
	});
}

/**
 * Binds `count` small elements, in a layer over the canvas, to the labels `label-0` onward that S1
 * tracks with the `labels` switch.
 */
function bindLabels(engine: Engine, count: number): void {
	if (count <= 0) return;
	const layer = document.createElement('div');
	layer.style.cssText = 'position: absolute; inset: 0; overflow: hidden; pointer-events: none';
	document.body.style.position = 'relative';
	document.body.append(layer);
	for (let k = 0; k < count; k++) {
		const element = document.createElement('div');
		element.style.cssText = 'width: 6px; height: 6px; background: #fff';
		layer.append(element);
		engine.labels.bind(`label-${k}`, element);
	}
}

/** Resolves once the GPU has finished the engine's first frame; rejects when a thread fails first. */
function firstFrameOrFailure(engine: Engine): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const stopWatching = engine.onFailure(reject);
		engine.firstFrame.then(() => {
			stopWatching();
			resolve();
		});
	});
}

/** How long the page waits for the thread that draws to send its WebGL call times. */
const GL_TIMING_WAIT_MS = 2000;

/**
 * The WebGL call times of the measured frames, from the thread that draws, or undefined when no
 * answer comes in time: a WebGPU page times no calls.
 */
function requestGlTiming(): Promise<GlTiming | undefined> {
	const channel = new BroadcastChannel(GL_TIMING_CHANNEL);
	return new Promise<GlTiming | undefined>((resolve) => {
		const timeout = setTimeout(() => resolve(undefined), GL_TIMING_WAIT_MS);
		channel.onmessage = (event: MessageEvent<GlTimingReport>) => {
			if (event.data?.type !== 'gl-timing') return;
			clearTimeout(timeout);
			const { frames, calls, slowestFrame } = event.data;
			resolve({ frames, calls, slowestFrame });
		};
		channel.postMessage(GL_TIMING_REQUEST);
	}).finally(() => channel.close());
}
