// S6's occlusion turns, T-36: what software occlusion culling saves and costs in the city, and
// whether it ever hides what shows. The page runs them with `?occlusion-turns` in place of a timed
// run, once the city is whole, with the governor off so the render scale holds.
//
// The turns measure the two sides, culling off and on, in `?rounds=` rounds (4 by default) of
// `?seconds=` seconds each (10 by default). Each round flies its own stretch of the route, and
// both its sides fly that stretch from the same start, after a second to settle. The side that runs
// first changes from round to round. Each side reports the medians of its rounds.
//
// The check of what culling hides wrongly at rest then holds the camera at `?stops=` stops along
// the route (24 by default). At each stop it captures the frame twice with culling off, then once
// with it on. The two frames with culling off differ only by the device's noise; a frame with
// culling on that differs from them by more than that shows that the culling hid something that
// shows. The PNG files of the first such stops go into the result, so people can see what went
// missing. Objects that show late in motion come from the visual check's popping figure, which the
// result carries as `lateInMotion` once the page runs it.
import type { Engine, FrameSummary } from '@null3d/engine';
import {
	differingPixels,
	hiddenAtRest,
	medianFigures,
	type OcclusionFigures,
	type OcclusionStop,
	type OcclusionTurnsResult,
	roundSides,
	roundStart,
	stopShares,
} from '../../../tests/pages/lib/occlusion';
import { occlusionFigures } from '../../../tests/pages/lib/occlusion-figures';
import { toBase64 } from '../../../tests/pages/lib/result';
import { S6_MESSAGES } from '../../scenes/s6';
import type { QualityLog } from './trace';

/** Seconds that each side flies before it measures, after the camera moves to the round's start. */
const SETTLE_SECONDS = 1;
/** Wrongly hidden stops whose frames go into the result: enough to see the fault, few to send. */
const HIDDEN_IMAGES = 2;

/** Runs the turns on an engine that draws S6, and resolves with their result. */
export async function occlusionTurns(
	engine: Engine,
	params: URLSearchParams,
	log: QualityLog | undefined,
): Promise<OcclusionTurnsResult> {
	const rounds = Number(params.get('rounds') ?? '4');
	const seconds = Number(params.get('seconds') ?? '10');
	const stopCount = Number(params.get('stops') ?? '24');
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	/** Sends the sketch a change, and resolves once a frame has it. */
	const change = (type: string, data: unknown) =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== S6_MESSAGES.done) return;
				off();
				resolve();
			});
			engine.postToSketch(type, data);
		});
	const cull = (on: boolean) => change(S6_MESSAGES.occlusion, on);
	const drive = (share: number, still: boolean) => change(S6_MESSAGES.drive, { share, still });
	// A measurement that holds no finished frame, as on a slow device, measures again for twice as long.
	const measure = async (): Promise<FrameSummary> => {
		for (let s = seconds; ; s *= 2) {
			const stats = await engine.measure(s);
			if (stats.frames > 0) return stats;
		}
	};

	const sides: Record<'off' | 'on', OcclusionFigures[]> = { off: [], on: [] };
	for (let round = 0; round < rounds; round++) {
		for (const side of roundSides(round)) {
			await cull(side === 'on');
			await drive(roundStart(round, rounds), false);
			await new Promise((resolve) => setTimeout(resolve, SETTLE_SECONDS * 1000));
			sides[side].push(occlusionFigures(await measure()));
		}
	}

	const stops: OcclusionStop[] = [];
	const images: Record<string, string> = {};
	for (const [k, share] of stopShares(stopCount).entries()) {
		await cull(false);
		await drive(share, true);
		const off = await engine.captureFrame();
		const again = await engine.captureFrame();
		await cull(true);
		const on = await engine.captureFrame();
		const stop = {
			share,
			noise: differingPixels(off.pixels, again.pixels),
			differing: differingPixels(off.pixels, on.pixels),
		};
		stops.push(stop);
		if (hiddenAtRest(stop) && Object.keys(images).length < 2 * HIDDEN_IMAGES) {
			images[`stop-${k}-off`] = await png(off);
			images[`stop-${k}-on`] = await png(on);
		}
	}

	const [renderScale] = log?.before(performance.now()) ?? [null];
	return {
		tier: engine.capabilities.tier,
		preset: engine.mode.preset,
		buffer: params.get('occlusion-buffer'),
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		renderScale,
		rounds,
		seconds,
		off: medianFigures(sides.off),
		on: medianFigures(sides.on),
		stops,
		...(Object.keys(images).length > 0 && { images }),
		failures,
	};
}

/** A captured frame as a PNG file in base64. */
async function png({
	width,
	height,
	pixels,
}: {
	width: number;
	height: number;
	pixels: Uint8Array;
}): Promise<string> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d') as CanvasRenderingContext2D;
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	return blob ? toBase64(new Uint8Array(await blob.arrayBuffer())) : '';
}
