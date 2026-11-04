// The shadow redraws of a still camera over a swaying grove: the frame's draw calls, which include
// one draw for each plant part in every shadow cascade that draws. ?sway=<metres> sets how far from
// the camera the plants move. With the distance inside the grove, the far trees stand still, so a
// far cascade that keeps its layer need not draw again; with 0, every tree sways and every far
// cascade draws in every frame. ?far places every row past the near cascades, so only the far ones
// reach the grove, and ?still holds the air. The camera holds still, so nothing but the plants can
// redraw a cascade.
import { createEngine, type QualityPreset } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** How far from the camera the plants sway, in meters: 0 moves them at every distance. */
const SWAY = Math.max(0, Number(params.get('sway') ?? 16));
/**
 * The seconds that the measurement runs for, when the page asks for them. Without that switch the
 * window is sized so that it holds a few frames on the machine that draws it, and the result says
 * how long it was, so a reader sees what the count covered.
 */
const ASKED_SECONDS = params.has('seconds') ? Math.max(0.5, Number(params.get('seconds'))) : null;
/** The shortest window, the longest, and the frames that the window aims to hold. */
const MIN_SECONDS = 2;
const LONGEST_SECONDS = 32;
const FRAMES_WANTED = 20;
/**
 * The frames that a window must hold before its count means anything: a far cascade is due once in
 * four frames at the Low preset, so a shorter window cannot hold the frame in which the schedule
 * held. The window grows while it holds fewer.
 */
const LEAST_FRAMES = 4;
/**
 * The longest that a probe waits for the machine to present a frame. A machine that presents none
 * in this long presents none in any window that the page allows, and the result then names the
 * empty window rather than a wait running out.
 */
const PROBE_LONGEST_SECONDS = 16;

run('vegetation-shadow-count', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/vegetation-wind-sketch.ts', import.meta.url);
	sketch.searchParams.set('sway', String(SWAY));
	if (params.has('far')) sketch.searchParams.set('far', '');
	if (params.has('still')) sketch.searchParams.set('still', '');
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: (params.get('preset') ?? 'low') as QualityPreset,
	});
	await engine.firstFrame;
	// Milliseconds from the page's start to its first frame, which separates a slow machine's start
	// from slow frames in the result.
	const firstFrameMs = Math.round(performance.now());
	// The first frames rebuild the draw tables and fill each cascade's layer, so the count settles
	// after them.
	progress('the first frame drew');
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const mode = { tier: engine.capabilities.tier, preset: engine.mode.preset };
	// The grove is heavy enough that a short window can hold no frame at all on a slow machine, and
	// a window that held none says nothing about the machine's speed. The probe therefore doubles
	// until it sees a frame, and the count window then aims to hold a few frames' worth of that
	// frame time.
	let probeSeconds = MIN_SECONDS;
	let probe = ASKED_SECONDS === null ? await engine.measure(probeSeconds) : null;
	while (probe !== null && probe.frames === 0 && probeSeconds < PROBE_LONGEST_SECONDS) {
		probeSeconds = Math.min(PROBE_LONGEST_SECONDS, probeSeconds * 2);
		probe = await engine.measure(probeSeconds);
	}
	const frameMs =
		probe === null || probe.frames === 0
			? null
			: probe.frames > 1
				? probe.intervalMs.median
				: (probe.seconds * 1000) / probe.frames;
	// A machine that showed no frame in the whole probe gets the longest window once, so its result
	// names the window that stayed empty.
	let seconds =
		ASKED_SECONDS ??
		(frameMs === null
			? LONGEST_SECONDS
			: Math.min(LONGEST_SECONDS, Math.max(MIN_SECONDS, (frameMs * FRAMES_WANTED) / 1000)));
	let stats = await engine.measure(seconds);
	// A frame time from a window that held one frame is a guess, and a window that holds fewer
	// frames than the cascade's interval can show cannot see the frame in which it held: both grow
	// the window.
	while (ASKED_SECONDS === null && stats.frames < LEAST_FRAMES && seconds < LONGEST_SECONDS) {
		seconds = Math.min(LONGEST_SECONDS, seconds * 2);
		stats = await engine.measure(seconds);
	}
	// What the probe saw, and the window it sized, so a result that read too few frames says whether
	// the probe saw none or saw slow ones. The window's length is published to a tenth of a second,
	// which is the resolution that a reader of a failure needs.
	const counted = {
		...mode,
		swayDistance: SWAY,
		far: params.has('far'),
		still: params.has('still'),
		seconds: Math.round(seconds * 10) / 10,
		firstFrameMs,
		probe: probe === null ? null : { seconds: probeSeconds, frames: probe.frames, frameMs },
	};
	if (stats.frames === 0) {
		await engine.destroy();
		return {
			...counted,
			frames: 0,
			drawCalls: 0,
			drawCallsLeast: 0,
			gpuMs: null,
			error: `the measurement window of ${counted.seconds} s presented no frame${probe === null ? '' : `, after a probe that grew to ${probeSeconds} s and held ${probe.frames}`}`,
		};
	}
	await engine.destroy();
	return {
		...counted,
		frames: stats.frames,
		drawCalls: stats.drawCalls.median,
		// The least draw calls of any frame in the window. A far cascade that holds draws nothing,
		// and one that is due draws whatever the plants do, so the least of the window is the frame
		// in which the schedule held, wherever in its cycle the window fell.
		drawCallsLeast: stats.drawCalls.min,
		gpuMs: stats.gpuMs?.median ?? null,
	};
});
