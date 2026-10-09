// A sun that moves refreshes the sky's environment within a fixed number of frames, and no frame
// draws a half-made map. The sky refresh sketch moves the sun from high in the sky to low behind
// the camera, and counts the frames since the move in squares that each capture shows. The engine
// core runs one stage of the map a frame: the sky in the move's frame, one filtered level in each
// of the next five, and the copy of every level into the map in the sixth. So the mirror sphere's
// reflection and the rough sphere's diffuse light keep the old sky's light for the first six
// frames, and both show the new sky's light from the seventh, the sixth after the move. On every
// GPU tier, with the drawing held to 20 frames a second so back-to-back captures miss few frames.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Frame {
	since: number;
	mirror: number[];
	rough: number[];
}

/** The frames from the move to the frame that draws with the new map: the map's stages. */
const STAGES = 7;
/** How far a color may stray from the old or the new sky's, in levels of 255. */
const NEAR = 4;
/** How far the old and the new sky's colors must lie apart, in levels of 255. */
const APART = 20;
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** The largest difference between two colors' channels. */
const distance = (a: number[], b: number[]) =>
	Math.max(...a.map((value, c) => Math.abs(value - (b[c] as number))));

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a sun move refreshes the sky's light within ${STAGES} frames on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.goto(`sky-refresh.html?gpu=${gpu}&fps=20`);
		const result = await pageResult<{ error?: string; tier: string; frames: Frame[] }>(
			page,
			60_000,
		);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const before = result.frames.filter((frame) => frame.since < 0);
		const after = result.frames.filter((frame) => frame.since >= 0);
		const old = before.at(-1) as Frame;
		const last = after.at(-1) as Frame;
		const report = result.frames
			.map((f) => `${f.since}: ${f.mirror.map(Math.round)} ${f.rough.map(Math.round)}`)
			.join('; ');
		expect(last?.since, report).toBe(15);
		expect(distance(old.mirror, last.mirror), report).toBeGreaterThan(APART);
		expect(distance(old.rough, last.rough), report).toBeGreaterThan(APART);
		expect(
			after.some((frame) => frame.since < STAGES - 1),
			report,
		).toBe(true);
		for (const frame of after) {
			const target = frame.since < STAGES - 1 ? old : last;
			expect(distance(frame.mirror, target.mirror), report).toBeLessThanOrEqual(NEAR);
			expect(distance(frame.rough, target.rough), report).toBeLessThanOrEqual(NEAR);
		}
	});
