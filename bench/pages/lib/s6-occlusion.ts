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
// missing.
//
// The check in motion then visits `?flights=` points along the route (24 by default). At each, the
// frames with culling off at both ends of a jump are the references, and their noise is the most
// that two captures at one end differ. Then, with culling on, the camera jumps between the two ends
// in every frame, so each frame shows the view one jump from the frame before, and the page
// captures a few such frames. A culling that used an earlier frame's camera would hide what came
// into view, so a capture that differs from the nearer end's reference by more than the noise shows
// an object late. The figure counts those captures.
import type { Engine, FrameSummary } from '@null3d/engine';
import {
	differingPixels,
	flightShares,
	hiddenAtRest,
	hidesWhatShows,
	JUMP_SHARE,
	lateFrames,
	medianFigures,
	type OcclusionFigures,
	type OcclusionFlight,
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
/**
 * Wrongly hidden stops, and points in motion, whose frames go into the result: enough to see the
 * fault, few to send.
 */
const HIDDEN_IMAGES = 2;
/**
 * Frames that the check in motion captures at each point. The camera's end changes in every frame,
 * and a capture takes the next frame the engine draws, so the captures cover both ends.
 */
const MOTION_CAPTURES = 4;

/** Runs the turns on an engine that draws S6, and resolves with their result. */
export async function occlusionTurns(
	engine: Engine,
	params: URLSearchParams,
	log: QualityLog | undefined,
): Promise<OcclusionTurnsResult> {
	const rounds = Number(params.get('rounds') ?? '4');
	const seconds = Number(params.get('seconds') ?? '10');
	const stopCount = Number(params.get('stops') ?? '24');
	const flightCount = Number(params.get('flights') ?? '24');
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
	const drive = (share: number, still: boolean, toward?: number) =>
		change(S6_MESSAGES.drive, { share, still, toward });
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

	const flights: OcclusionFlight[] = [];
	let shownFlights = 0;
	for (const [k, share] of flightShares(flightCount).entries()) {
		const toward = share + JUMP_SHARE;
		await cull(false);
		const ends: Capture[] = [];
		let noise = 0;
		for (const end of [share, toward]) {
			await drive(end, true);
			const first = await engine.captureFrame();
			noise = Math.max(noise, differingPixels(first.pixels, (await engine.captureFrame()).pixels));
			ends.push(first);
		}
		await cull(true);
		await drive(share, true, toward);
		const differing: number[] = [];
		let shown: { off: Capture; on: Capture } | undefined;
		for (let c = 0; c < MOTION_CAPTURES; c++) {
			const on = await engine.captureFrame();
			const [off, pixels] = nearest(ends, on);
			differing.push(pixels);
			if (hidesWhatShows(noise, pixels)) shown ??= { off, on };
		}
		flights.push({ share, toward, noise, differing });
		if (shown && shownFlights++ < HIDDEN_IMAGES) {
			images[`flight-${k}-off`] = await png(shown.off);
			images[`flight-${k}-on`] = await png(shown.on);
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
		flights,
		lateInMotion: flights.reduce((sum, flight) => sum + lateFrames(flight), 0),
		...(Object.keys(images).length > 0 && { images }),
		failures,
	};
}

/** A frame that `engine.captureFrame` read back. */
type Capture = Awaited<ReturnType<Engine['captureFrame']>>;

/** The reference nearest a frame, and the pixels where the two differ. */
function nearest(references: readonly Capture[], frame: Capture): [Capture, number] {
	let best: [Capture, number] = [frame, Number.POSITIVE_INFINITY];
	for (const reference of references) {
		const pixels = differingPixels(reference.pixels, frame.pixels);
		if (pixels < best[1]) best = [reference, pixels];
	}
	return best;
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
