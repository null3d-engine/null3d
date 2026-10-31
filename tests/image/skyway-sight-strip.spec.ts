// A filmstrip for the owner's look: the Skyway hero car hovering just past a tower's corner, with
// the chase camera behind it. The camera must keep the car in sight, so a tower never hides it. The
// strip draws the car's neon band, and a frame where the tower covers the camera's line to the car
// leaves no band to count. Run it on a computer with a GPU of its own:
//   NULL3D_SKYWAY_SIGHT_COST=1 bun run test:browser -- skyway-sight-strip.spec.ts
// Set NULL3D_SKYWAY_SIGHT_OUT to name the folder, so frames drawn with the older camera and with
// the new one sit apart.
import { mkdirSync } from 'node:fs';
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

/** The seconds that the chase camera has to settle before each frame. */
const TIMES = [0.25, 0.5, 1, 2, 4] as const;

/** What the image page publishes: the frame's size and its pixels, base64. */
interface FrameResult {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** A frame of the proof sketch at `t` seconds, as 8-bit RGBA pixels. */
async function frame(
	page: import('@playwright/test').Page,
	t: number,
	quiet = false,
	run = 'corner',
): Promise<{ width: number; height: number; data: Uint8Array }> {
	const flags = `${quiet ? '&quiet=1' : ''}${run === 'corner' ? '' : `&run=${run}`}`;
	const sketch = `/tests/pages/sketches/skyway-sight-sketch.ts?t=${t}${flags}`;
	const query = `gpu=webgpu&hold=0&size=640x360&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<FrameResult>(page, 120_000);
	expect(result.error).toBeUndefined();
	const data = new Uint8Array(Buffer.from(result.pixels, 'base64'));
	return { width: result.width, height: result.height, data };
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

test('the chase camera keeps the car in sight past a tower', async ({ page }) => {
	test.setTimeout(300_000);
	mkdirSync(OUT, { recursive: true });
	const counts: { t: number; neon: number }[] = [];
	// A control frame with no tower, so a frame that loses the car names the tower or the camera.
	const open = await frame(page, 2, true);
	writePng(join(OUT, 'skyway-sight-open.png'), open);
	console.log(`no tower: ${neon(open)} neon pixels`);
	for (const t of TIMES) {
		const pixels = await frame(page, t);
		writePng(join(OUT, `skyway-sight-${t.toFixed(2)}.png`), pixels);
		counts.push({ t, neon: neon(pixels) });
	}
	console.log(counts.map((one) => `t ${one.t}: ${one.neon} neon pixels`).join('\n'));
	// The car's neon band shows in every frame once the camera has eased into place. A frame where
	// the tower stands between the camera and the car counts none of it. The older camera's run sets
	// NULL3D_SKYWAY_SIGHT_OLD, so the frames that lose the car are kept for the comparison.
	if (!process.env.NULL3D_SKYWAY_SIGHT_OLD)
		for (const one of counts) expect(one.neon, `t ${one.t}`).toBeGreaterThan(0);
});

// The car flies north along a tower's face and turns away: the swing brings the tower across the
// camera's line. The car must stay in sight the whole way, and the band's growth from frame to frame
// shows the pull closing at a steady rate rather than snapping.
test('the pull eases through a turn away from a tower', async ({ page }) => {
	test.setTimeout(300_000);
	mkdirSync(OUT, { recursive: true });
	const times = [1, 1.5, 2, 2.5, 3, 3.5, 4] as const;
	const counts: { t: number; neon: number }[] = [];
	for (const t of times) {
		const pixels = await frame(page, t, false, 'turn');
		writePng(join(OUT, `skyway-turn-${t.toFixed(2)}.png`), pixels);
		counts.push({ t, neon: neon(pixels) });
	}
	console.log(counts.map((one) => `turn t ${one.t}: ${one.neon} neon pixels`).join('\n'));
	for (const one of counts) expect(one.neon, `turn t ${one.t}`).toBeGreaterThan(0);
});
