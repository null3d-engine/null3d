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
const LONGEST_SECONDS = 10;
const FRAMES_WANTED = 20;

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
	// The first frames rebuild the draw tables and fill each cascade's layer, so the count settles
	// after them.
	progress('the first frame drew');
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const mode = { tier: engine.capabilities.tier, preset: engine.mode.preset };
	// The grove is heavy enough that a fixed window can hold no frame at all on a slow machine, so
	// a short window measures the machine's own frame time first, and the real window then aims to
	// hold a few frames' worth of it.
	const probe = ASKED_SECONDS === null ? await engine.measure(MIN_SECONDS / 4) : null;
	const frameMs = probe !== null && probe.frames > 0 ? (probe.seconds * 1000) / probe.frames : null;
	const seconds =
		ASKED_SECONDS ??
		Math.min(
			LONGEST_SECONDS,
			Math.max(MIN_SECONDS, frameMs === null ? MIN_SECONDS : (frameMs * FRAMES_WANTED) / 1000),
		);
	const stats = await engine.measure(seconds);
	if (stats.frames === 0) {
		await engine.destroy();
		return {
			...mode,
			swayDistance: SWAY,
			far: params.has('far'),
			still: params.has('still'),
			seconds,
			frames: 0,
			drawCalls: 0,
			drawCallsLeast: 0,
			gpuMs: null,
			error: `the measurement window of ${seconds} s presented no frame`,
		};
	}
	await engine.destroy();
	return {
		...mode,
		swayDistance: SWAY,
		far: params.has('far'),
		still: params.has('still'),
		seconds,
		frames: stats.frames,
		drawCalls: stats.drawCalls.median,
		// The least draw calls of any frame in the window. A far cascade that holds draws nothing,
		// and one that is due draws whatever the plants do, so the least of the window is the frame
		// in which the schedule held, wherever in its cycle the window fell.
		drawCallsLeast: stats.drawCalls.min,
		gpuMs: stats.gpuMs?.median ?? null,
	};
});
