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

/** The seconds that the chase camera has to settle before each frame. The first steps show the
 * pull leaving the blocked rest, and the last two show the camera at rest once it has settled. */
const TIMES = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 4, 6, 8] as const;

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
	/** The nearest car pixel to a frame edge, in pixels, or -1 when no car pixel shows. */
	margin: number;
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

/** The car's coloured pixels: its cyan band and its amber stripe. The cyan test is the strict one
 * a look audit uses for the turn frames, because the tower's lit wall passes the loose test. */
function carPixel(r: number, g: number, b: number): boolean {
	const cyan = b > 150 && g > 110 && b - r > 40 && g - r > 15;
	const amber = r > 140 && g > 60 && r - b > 50 && g - b > 10;
	return cyan || amber;
}

/**
 * The nearest car-coloured pixel to a frame edge, in pixels, or -1 when the frame shows none. A
 * cropped car reads 0; a whole one reads how much clear frame surrounds it.
 */
function carMargin(frame: { width: number; height: number; data: Uint8Array }): number {
	let nearest = Number.POSITIVE_INFINITY;
	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < frame.width; x++) {
			const i = (y * frame.width + x) * 4;
			if (!carPixel(frame.data[i] ?? 0, frame.data[i + 1] ?? 0, frame.data[i + 2] ?? 0)) continue;
			nearest = Math.min(nearest, x, y, frame.width - 1 - x, frame.height - 1 - y);
		}
	}
	return Number.isFinite(nearest) ? nearest : -1;
}

/** How many pixels differ between two frames by more than 12 summed channel steps, as a share. */
function changed(a: Uint8Array, b: Uint8Array): number {
	if (a.length !== b.length) return 1;
	let count = 0;
	for (let i = 0; i < a.length; i += 4) {
		const diff =
			Math.abs((a[i] ?? 0) - (b[i] ?? 0)) +
			Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)) +
			Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0));
		if (diff > 12) count++;
	}
	return count / (a.length / 4);
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
	frames.push({
		t,
		quiet,
		run,
		distance: pixels.distance,
		neon: neon(pixels),
		margin: carMargin(pixels),
		file,
	});
}

test('the chase camera keeps the car in sight past a tower', async ({ page }) => {
	test.setTimeout(300_000);
	mkdirSync(OUT, { recursive: true });
	const frames: FrameEntry[] = [];
	const drawn = new Map<number, Frame>();
	// A control frame with no tower, so a frame that loses the car names the tower or the camera.
	// The control leaves the tower out of the camera's tower list too, so it shows the camera at
	// rest rather than a second blocked view.
	const open = await frame(page, 2, true);
	keep(frames, open, 2, true, 'corner', 'skyway-sight-open');
	for (const t of TIMES) {
		const pixels = await frame(page, t);
		drawn.set(t, pixels);
		keep(frames, pixels, t, false, 'corner', 'skyway-sight');
	}
	writeFileSync(join(OUT, 'skyway-sight-frames.json'), JSON.stringify(frames, null, 2));
	console.log(
		frames
			.map(
				(one) =>
					`t ${one.t} quiet ${one.quiet}: ${one.distance.toFixed(1)} m, ${one.neon} neon, margin ${one.margin}`,
			)
			.join('\n'),
	);
	// The frame at rest, before any pull, is the blocked view that the owner reported: it names the
	// state the pull cures, so it is logged and left out of the checks below. The older camera's run
	// sets NULL3D_SKYWAY_SIGHT_OLD, so the frames that lose the car are kept for the comparison.
	const rest = frames.find((one) => !one.quiet && one.t === 0);
	expect(rest, 'the blocked rest frame').toBeDefined();
	if (!process.env.NULL3D_SKYWAY_SIGHT_OLD) {
		const control = frames.find((one) => one.quiet);
		expect(control?.neon ?? 0, 'control').toBeGreaterThan(0);
		expect(control?.margin ?? -1, 'control car margin').toBeGreaterThanOrEqual(4);
		for (const one of frames) {
			// The rest and the swing's own approach are logged, not judged here: the camera passes the
			// tower's near side while it eases onto its held side, and the car fills the frame there.
			if (one.quiet || one.t < 1) continue;
			expect(one.neon, `t ${one.t}`).toBeGreaterThan(0);
			// The car's coloured pixels, its band and its stripe, keep clear of every frame edge: the
			// whole car shows, with a margin, rather than a tip clipped by the left edge.
			expect(one.margin, `t ${one.t} car margin`).toBeGreaterThanOrEqual(4);
		}
		// The camera holds the side it chose: two frames two seconds apart, after the swing has
		// eased, show the same picture, as both earlier cameras did.
		const early = drawn.get(6);
		const late = drawn.get(8);
		expect(early && late, 'frames at 6 and 8 seconds').toBeTruthy();
		if (early && late) expect(changed(early.data, late.data), '6 to 8 seconds').toBe(0);
	}
});

// The car flies north along a tower's face and turns away: the swing brings the tower across the
// camera's line. The car must stay in sight and whole the whole way, and the fine frames cross the
// swing itself, from 2.50 to 2.75 seconds, where the distance falls.
test('the pull eases through a turn away from a tower', async ({ page }) => {
	test.setTimeout(300_000);
	mkdirSync(OUT, { recursive: true });
	const times = [0, 0.5, 1, 1.5, 2, 2.5, 2.55, 2.6, 2.65, 2.7, 2.75, 3, 3.5, 4] as const;
	const frames: FrameEntry[] = [];
	for (const t of times) {
		keep(frames, await frame(page, t, false, 'turn'), t, false, 'turn', 'skyway-turn');
	}
	writeFileSync(join(OUT, 'skyway-turn-frames.json'), JSON.stringify(frames, null, 2));
	console.log(
		frames
			.map(
				(one) =>
					`turn t ${one.t}: ${one.distance.toFixed(1)} m, ${one.neon} neon, margin ${one.margin}`,
			)
			.join('\n'),
	);
	for (const one of frames) {
		expect(one.neon, `turn t ${one.t}`).toBeGreaterThan(0);
		expect(one.margin, `turn t ${one.t} car margin`).toBeGreaterThanOrEqual(4);
	}
});
