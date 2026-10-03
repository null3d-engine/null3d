// Shadows meet their casters the same way while the camera turns. The shadow contact sketch's turn
// view looks at car-sized boxes from about 27 m away, just past where the first cascade ends. A turn
// on the spot moves a box toward the side of the view, where its distance along the view falls
// inside the first cascade. A receiver that picked its cascade by that distance would then read
// texels of another size, and the line of light at the box's base and its shadow's edges would
// change as the view turns. A receiver picks its cascade by its distance from the camera, which a
// turn leaves the same, so each pixel of the ground must keep its brightness. On both GPU paths,
// which draw shadows with the same code.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { CONTACT_TURN, CONTACT_TURN_PITCH, inFirstFrame } from '../pages/lib/shadow-turn.ts';

interface ImageResult {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

const [WIDTH, HEIGHT] = [480, 270];
/** The frames' size and lens, for the map between them. */
const FRAME = {
	width: WIDTH,
	height: HEIGHT,
	fovDegrees: CONTACT_TURN.fovDegrees,
	pitchDegrees: CONTACT_TURN_PITCH,
};
/** The camera's turns in degrees. The first frame is the one the others map onto. */
const YAWS = [0, 20, 25];
/** A pixel differs where its brightness changes by more than this share of the lit ground's. */
const CHANGE = 0.1;
/**
 * The share of compared pixels that may differ: a few, where a pixel rounds onto an edge. A turn
 * that moved the boxes into the first cascade changed 0.24% to 0.27% of them on the Mac.
 */
const MAX_DIFFERENT = 0.001;

/** A frame's pixels: the brightness of each, the sum of its red, green and blue, and its redness. */
async function drawn(page: import('@playwright/test').Page, gpu: string, yaw: number) {
	const sketch = `/tests/pages/sketches/shadow-contact-sketch.ts?view=turn&yaw=${yaw}`;
	const query = `gpu=${gpu}&hold=0&size=${WIDTH}x${HEIGHT}&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<ImageResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect([result.width, result.height]).toEqual([WIDTH, HEIGHT]);
	const rgba = Buffer.from(result.pixels, 'base64');
	const light = new Float32Array(WIDTH * HEIGHT);
	const box = new Uint8Array(WIDTH * HEIGHT);
	for (let i = 0; i < light.length; i++) {
		const [r, g, b] = [rgba[i * 4] ?? 0, rgba[i * 4 + 1] ?? 0, rgba[i * 4 + 2] ?? 0];
		light[i] = r + g + b;
		// The boxes are red, and the ground and its shadows gray.
		box[i] = r > 2 * b + 20 ? 1 : 0;
	}
	return { yaw, light, box };
}

/** True when pixel (x, y) or a pixel next to it shows a box. */
function nearBox(box: Uint8Array, x: number, y: number): boolean {
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) if (box[(y + dy) * WIDTH + x + dx]) return true;
	return false;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`shadows meet their casters the same way while the camera turns on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const frames = [];
		for (const yaw of YAWS) frames.push(await drawn(page, gpu, yaw));
		const [first, ...turned] = frames;
		if (!first) throw new Error('no first frame');
		// Most of the frame is lit ground.
		const ground = first.light.filter((_, i) => !first.box[i]).sort();
		const lit = ground[Math.floor(ground.length / 2)] ?? 0;
		expect(lit, 'the ground is lit').toBeGreaterThan(300);
		for (const frame of turned) {
			let compared = 0;
			let different = 0;
			for (let y = 0; y < HEIGHT; y++)
				for (let x = 0; x < WIDTH; x++) {
					const seen = inFirstFrame(FRAME, x, y, frame.yaw, 1);
					if (!seen || frame.box[y * WIDTH + x]) continue;
					const [x0, y0] = seen;
					if (nearBox(first.box, x0, y0)) continue;
					compared++;
					const change = (frame.light[y * WIDTH + x] ?? 0) - (first.light[y0 * WIDTH + x0] ?? 0);
					if (Math.abs(change) > CHANGE * lit) different++;
				}
			expect(compared, `pixels compared at ${frame.yaw} degrees`).toBeGreaterThan(
				WIDTH * HEIGHT * 0.3,
			);
			expect(different / compared, `share that differs at ${frame.yaw} degrees`).toBeLessThan(
				MAX_DIFFERENT,
			);
		}
	});
