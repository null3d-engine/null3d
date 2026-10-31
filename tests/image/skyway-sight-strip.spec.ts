// A filmstrip for the owner's look: the Skyway hero car hovering just past a tower's corner, with
// the chase camera behind it. The camera must keep the car in sight, so a tower never hides it. The
// strip draws the car's neon band, and a frame where the tower covers the camera's line to the car
// leaves no band to count. Each frame's file name and the sidecar give the camera's distance from
// the car, so the pull can be read rather than inferred. Run it on a computer with a GPU of its own:
//   NULL3D_SKYWAY_SIGHT_COST=1 bun run test:browser -- skyway-sight-strip.spec.ts
// Set NULL3D_SKYWAY_SIGHT_OUT to name the folder, so frames drawn with the older camera and with
// the new one sit apart.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { writePng } from '../../packages/cli/src/png.js';
import { pageResult } from '../lib/page-result.ts';

test.skip(
	!process.env.NULL3D_SKYWAY_SIGHT_COST,
	'set NULL3D_SKYWAY_SIGHT_COST to draw the filmstrip',
);

/** Where the frames go, from the repository the tests run in, under the set's own name. */
const OUT = join(
	process.cwd(),
	'target',
	'sight-strip',
	process.env.NULL3D_SKYWAY_SIGHT_OUT ?? 'new',
);

/** The seconds that the chase camera has to settle before each frame. The first second is
 * sampled closely, so the approach can be judged rather than only where it ends. */
const TIMES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 4] as const;

/** What the image page publishes: the frame's size and its pixels, base64. */
interface FrameResult {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** A drawn frame, its pixels, and the camera's distance from the car in meters. */
interface Frame {
	width: number;
	height: number;
	data: Uint8Array;
	distance: number;
}

/** What the sidecar keeps for one frame. */
interface FrameEntry {
	t: number;
	quiet: boolean;
	run: string;
	distance: number;
	neon: number;
	file: string;
}

/** A frame of the proof sketch at `t` seconds, as 8-bit RGBA pixels. */
async function frame(
	page: import('@playwright/test').Page,
	t: number,
	quiet = false,
	run = 'corner',
): Promise<Frame> {
	const flags = `${quiet ? '&quiet=1' : ''}${run === 'corner' ? '' : `&run=${run}`}`;
	const sketch = `/tests/pages/sketches/skyway-sight-sketch.ts?t=${t}${flags}`;
	// The sketch runs on the page's own thread, so the strip can read the camera's distance from it:
	// the engine's default worker cannot reach the page's window.
	const query = `gpu=webgpu&hold=0&size=640x360&sketch-thread=main&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<FrameResult>(page, 120_000);
	expect(result.error).toBeUndefined();
	const camera = await page.evaluate(() => {
		const value = (globalThis as unknown as { sightDistance?: unknown }).sightDistance;
		return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
	});
	const data = new Uint8Array(Buffer.from(result.pixels, 'base64'));
	return { width: result.width, height: result.height, data, distance: camera };
}

/** The pixels of the car's cyan neon band: blue and green well above red. */
function neon(pixels: { data: Uint8Array }): number {
	let count = 0;
	for (let i = 0; i < pixels.data.length; i += 4) {
		const [r, g, b] = [pixels.data[i] ?? 0, pixels.data[i + 1] ?? 0, pixels.data[i + 2] ?? 0];
		if (b > 100 && g > 70 && b - r > 40 && g - r > 15) count++;
	}
	return count;
}

/** Writes the frame under a name that carries its distance, and adds its entry to the sidecar. */
function keep(
	frames: FrameEntry[],
	pixels: Frame,
	t: number,
	quiet: boolean,
	run: string,
	prefix: string,
): void {
	const file = `${prefix}-${t.toFixed(2)}-d${pixels.distance.toFixed(1)}.png`;
	writePng(join(OUT, file), pixels);
	frames.push({ t, quiet, run, distance: pixels.distance, neon: neon(pixels), file });
}

test('the chase camera keeps the car in sight past a tower', async ({ page }) => {
	test.setTimeout(300_000);
	mkdirSync(OUT, { recursive: true });
	const frames: FrameEntry[] = [];
	// A control frame with no tower, so a frame that loses the car names the tower or the camera.
	// The control leaves the tower out of the camera's tower list too, so it shows the camera at
	// rest rather than a second blocked view.
	const open = await frame(page, 2, true);
	keep(frames, open, 2, true, 'corner', 'skyway-sight-open');
	for (const t of TIMES) {
		keep(frames, await frame(page, t), t, false, 'corner', 'skyway-sight');
	}
	writeFileSync(join(OUT, 'skyway-sight-frames.json'), JSON.stringify(frames, null, 2));
	console.log(
		frames
			.map(
				(one) =>
					`t ${one.t} quiet ${one.quiet}: ${one.distance.toFixed(1)} m, ${one.neon} neon pixels`,
			)
			.join('\n'),
	);
	// The car's neon band shows in every frame once the camera has eased into place. A frame where
	// the tower stands between the camera and the car counts none of it. The older camera's run sets
	// NULL3D_SKYWAY_SIGHT_OLD, so the frames that lose the car are kept for the comparison.
	if (!process.env.NULL3D_SKYWAY_SIGHT_OLD)
		for (const one of frames) expect(one.neon, `t ${one.t}`).toBeGreaterThan(0);
});

// The car flies north along a tower's face and turns away: the swing brings the tower across the
// camera's line. The car must stay in sight the whole way, and the distance sidecar shows the pull
// closing and easing back out rather than snapping.
test('the pull eases through a turn away from a tower', async ({ page }) => {
	test.setTimeout(300_000);
	mkdirSync(OUT, { recursive: true });
	const times = [1, 1.5, 2, 2.25, 2.3, 2.35, 2.4, 2.45, 2.5, 2.75, 3, 3.25, 3.5, 4] as const;
	const frames: FrameEntry[] = [];
	for (const t of times) {
		keep(frames, await frame(page, t, false, 'turn'), t, false, 'turn', 'skyway-turn');
	}
	writeFileSync(join(OUT, 'skyway-turn-frames.json'), JSON.stringify(frames, null, 2));
	console.log(
		frames
			.map((one) => `turn t ${one.t}: ${one.distance.toFixed(1)} m, ${one.neon} neon pixels`)
			.join('\n'),
	);
	for (const one of frames) expect(one.neon, `turn t ${one.t}`).toBeGreaterThan(0);
});
