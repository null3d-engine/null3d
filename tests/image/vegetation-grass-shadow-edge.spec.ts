// The near grass shadows at a low sun must reach the sun-side edge of the frame, and not stop at a
// straight line inside it. The blade list is culled against the main camera's view, and the shadow
// views draw that same list, so a cull that stops at the view's edge leaves the ground at that edge
// lit where the blades just beyond it would have thrown shadow. This view looks at the hill from
// in front, with the sun behind the camera and to its right, so the shadows run toward the camera
// and the edge they must reach is the frame's near, bottom edge. A cull with no reach past the
// view drops the blades just outside that edge, and their shadows leave with them.
//
// The measure: of the ground pixels in the bottom sixteenth of the frame, the share darker than a
// shadow level, against that share over the frame's whole ground. The honest references keep most
// of the frame's share, and a cull that stops at the view's edge leaves the strip with none. The
// honest readings are 0.79 on WebGPU, 0.91 in compatibility mode, 0.88 on WebGL2 and 0.93 on the
// software GPU; a cull whose tile radius is 0 measures 0.00 on WebGPU, so the floor sits well under
// every honest reading and well over a cut.
import { expect, test } from '@playwright/test';
import { environmentNamed, type ImageRun, runIn } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** The picture of the grass's near shadows at a low sun, from the image test manifest. */
const NAME = 'vegetation-grass-shadow';

/** The least share of the frame's ground shadow that the near edge must keep. */
const NEAR_MIN = 0.45;

/** The luminance, from 0 to 1, at and under which a ground pixel counts as shadowed. */
const SHADOW_LEVEL = 0.17;

/** How far a pixel's green must lead its red to be a blade rather than the ground. */
const BLADE_GREEN = 0.14;

/** The rows below this share of the frame hold the hill's ground, above the crest's sky. */
const CREST = 0.3;

/** The height of the near strip, as a share of the frame. */
const NEAR = 1 / 16;

/** The smallest number of ground pixels that one reading counts, so it cannot pass on an empty frame. */
const GROUND_FLOOR = 10_000;

/** The near-edge reading of a drawn frame. */
interface NearReading {
	/** The shadowed share of the ground in the near strip. */
	near: number;
	/** The shadowed share of the frame's whole ground. */
	frame: number;
	/** How many ground pixels the frame's reading counted. */
	ground: number;
}

/** Whether a pixel is the ground, rather than the sky or a green blade. */
function isGround(r: number, g: number, b: number): boolean {
	if (b > g && b > r) return false;
	return g - r <= BLADE_GREEN;
}

/** Whether a ground pixel is shadowed. */
const isShadow = (r: number, g: number, b: number) =>
	0.2126 * r + 0.7152 * g + 0.0722 * b < SHADOW_LEVEL;

/** The near-edge reading of one drawn frame's RGBA pixels. */
function nearReading(pixels: Uint8Array, width: number, height: number): NearReading {
	let nearGround = 0;
	let nearShadow = 0;
	let frameGround = 0;
	let frameShadow = 0;
	const strip = height * (1 - NEAR);
	for (let y = Math.floor(height * CREST); y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = 4 * (y * width + x);
			const r = (pixels[i] ?? 0) / 255;
			const g = (pixels[i + 1] ?? 0) / 255;
			const b = (pixels[i + 2] ?? 0) / 255;
			if (!isGround(r, g, b)) continue;
			const shadow = isShadow(r, g, b);
			frameGround++;
			if (shadow) frameShadow++;
			if (y < strip) continue;
			nearGround++;
			if (shadow) nearShadow++;
		}
	if (nearGround === 0 || frameGround === 0) return { near: 0, frame: 0, ground: frameGround };
	return {
		near: nearShadow / nearGround,
		frame: frameShadow / frameGround,
		ground: frameGround,
	};
}

for (const run of IMAGE_RUNS.filter((candidate) => candidate.test === NAME))
	test(`${NAME} on ${run.tier}: the near shadows reach the sun-side edge`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(run.timeoutSeconds * 1000);
		const placed: ImageRun = runIn(run, environmentNamed(testInfo.project.name));
		const result = await loadResult(page, placed.path, run.timeoutSeconds * 1000);
		expect(result.ok ? [] : [failureText(result)]).toEqual([]);
		const pixels = new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
		const width = result.width as number;
		const height = result.height as number;
		expect(pixels.length).toBe(width * height * 4);
		const reading = nearReading(pixels, width, height);
		console.log(
			`${run.id}: the near sixteenth of the ground holds ${reading.near.toFixed(3)} shadow against ${reading.frame.toFixed(3)} over the frame, on ${reading.ground} ground pixels`,
		);
		expect(reading.ground).toBeGreaterThan(GROUND_FLOOR);
		expect(reading.frame).toBeGreaterThan(0.05);
		// A cull that ends at the view's edge takes the strip to no shadow at all.
		expect(
			reading.near / reading.frame,
			`${run.id}: the shadows reach the near, sun-side edge`,
		).toBeGreaterThan(NEAR_MIN);
	});
