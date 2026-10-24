// A custom material's vertex offset that reads a compute pass's texture, in the motion pass's
// second call: the pass writes this frame's value and the frame before's, and the vertex offset
// takes the row that `frame.lastFrame` names. Without that value the second call would read this
// frame's row, the surface would show no motion, and the plane would be still in the debug view.
// The plane moves at six meters a second, which is two pixels a frame on the exact case's view.
import { expect, test } from '@playwright/test';
import { imageRuns, TIERS } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import {
	decodeMotion,
	MOTION_HOLD,
	pixelOf,
	pixelsPerFrame,
	SIZE,
	SWAY,
} from '../pages/lib/motion-vectors.ts';

const SKETCH = 'tests/pages/sketches/compute-vertex-offset-sketch.ts';

/** How far a decoded motion may stray from the expected one, in pixels. */
const TOLERANCE = 0.5;

const near = ([x, y]: readonly [number, number], want: readonly [number, number]) =>
	Math.hypot(x - want[0], y - want[1]) <= TOLERANCE;

for (const tier of TIERS) {
	test(`a vertex offset that reads a compute output shows its motion on ${tier}`, async ({
		page,
	}) => {
		const [run] = imageRuns([
			{
				name: 'compute-vertex-offset-motion',
				sketch: `${SKETCH}?case=motion`,
				hold: MOTION_HOLD,
				tiers: [tier],
			},
		]);
		if (!run) throw new Error('a sketch test has a run on its tier');
		const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
		expect(result.ok ? [] : [failureText(result)]).toEqual([]);
		const pixels = new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
		const motion = (x: number, y: number) => {
			const [column, row] = pixelOf(x, y);
			const index = row * SIZE[0] + column;
			return decodeMotion(
				pixels[index * 4] ?? 0,
				pixels[index * 4 + 1] ?? 0,
				pixels[index * 4 + 2] ?? 0,
			);
		};
		const want: readonly [number, number] = [pixelsPerFrame(SWAY), 0];
		// The plane stands three meters to the right at the hold time, where the pass's value puts it.
		const plane = motion(3, 0);
		expect([
			...(near(plane, want) ? [] : [`the plane moved ${plane} pixels, not ${want}`]),
			...(near(motion(6, -4), [0, 0]) ? [] : [`the wall moved ${motion(6, -4)} pixels`]),
		]).toEqual([]);
	});
}
