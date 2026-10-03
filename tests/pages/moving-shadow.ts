// Runs the shadow contact sketch with its driving box, live, with far cascades that draw every
// ?far=<n> frames, and reads several frames back while the box drives. For each frame it reports
// how far the box's shadow lies from the box along the image's x axis, in pixels: the mean x of the
// shadow's pixels minus the mean x of the box's. A shadow that follows its caster keeps one offset
// in every frame.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** Frames read back, and animation frames between two reads. */
const READS = 8;
const GAP_FRAMES = 3;
/** Rows above the box that its shadow can reach in the image. */
const SHADOW_ROWS = 16;
/** Gray ground darker than this share of the lit ground's brightness counts as shadow. */
const SHADOWED = 0.85;
/** The most that a gray pixel's blue may exceed its red. */
const GRAY = 30;

/** The offset of the driving box's shadow in one frame's RGBA8 pixels, or null without either. */
function shadowOffset(width: number, height: number, pixels: Uint8Array): number | null {
	const at = (x: number, y: number) => (y * width + x) * 4;
	const brightness = (i: number) =>
		(pixels[i] as number) + (pixels[i + 1] as number) + (pixels[i + 2] as number);
	const blue = (i: number) => (pixels[i + 2] as number) > 150 && (pixels[i] as number) < 120;
	// Gray, as the ground is: the box's own faces in shade stay blue.
	const gray = (i: number) => (pixels[i + 2] as number) - (pixels[i] as number) < GRAY;
	let [boxX, boxN, top, bottom] = [0, 0, height, 0];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			if (blue(at(x, y))) {
				boxX += x;
				boxN++;
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
	if (boxN === 0) return null;
	// The shadow: ground darker than the lit ground in the box's rows and the rows above them,
	// where the sun casts it. The still boxes and their shadows lie below.
	const lit = brightness(at(width - 4, 4));
	let [shadowX, shadowN] = [0, 0];
	for (let y = Math.max(0, top - SHADOW_ROWS); y <= bottom; y++)
		for (let x = 0; x < width; x++) {
			const i = at(x, y);
			if (gray(i) && brightness(i) < SHADOWED * lit) {
				shadowX += x;
				shadowN++;
			}
		}
	return shadowN === 0 ? null : shadowX / shadowN - boxX / boxN;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

run('moving-shadow', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/shadow-contact-sketch.ts', import.meta.url);
	sketch.searchParams.set('moving', '');
	sketch.searchParams.set('far', new URLSearchParams(location.search).get('far') ?? '1');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	await engine.firstFrame;
	const offsets: (number | null)[] = [];
	for (let read = 0; read < READS; read++) {
		for (let k = 0; k < GAP_FRAMES; k++) await nextFrame();
		const { width, height, pixels } = await engine.captureFrame();
		offsets.push(shadowOffset(width, height, pixels));
	}
	await engine.destroy();
	return { tier: engine.capabilities.tier, offsets };
});
