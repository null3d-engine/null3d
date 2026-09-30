// Draws the depth precision scene on the GPU path and in the WebGL2 depth mode that the switches ask
// for, in hold mode with ?hold=. It publishes the frame with each fighting pixel painted as the
// nearer surface, which every GPU draws alike, and the fighting pixels themselves as data.
import { createEngine } from '@null3d/engine';
import { countFighting, precisionFacts, withoutFighting } from './lib/depth-precision';
import { run, toBase64 } from './lib/result';

run('depth-precision', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/depth-precision-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const frame = await engine.captureFrame();
	await engine.destroy();
	const { tier, depth } = engine.capabilities;
	const clipControl = engine.report.webgl2.extensions.EXT_clip_control === true;
	// Every path draws reversed depth unless ?depth= asks for another, or WebGL2 lacks the extension.
	const asked = new URLSearchParams(location.search).get('depth') ?? 'reversed';
	return {
		tier,
		mode: engine.mode,
		depth,
		clipControl,
		drewAsked: depth === asked || (asked === 'reversed' && tier === 'webgl2' && !clipControl),
		...precisionFacts(countFighting(frame.pixels, frame.width, frame.height)),
		width: frame.width,
		height: frame.height,
		pixels: toBase64(withoutFighting(frame.pixels)),
	};
});
