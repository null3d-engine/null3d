// A sky layer takes a share of the sun, and the core sky dims its disc by the rest. This test reads
// the disc's middle and a block of plain sky beside it before a layer arrives, with a layer that
// hides the whole sun, and after that layer is removed. The disc must go dark and come back, and the
// plain sky must not move.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Capture {
	stretch: number;
	frame: number;
	disc: number[];
	plain: number[];
}

/** The stretch of the captures with no layer, with one that hides the sun, and after it is removed. */
const [BEFORE, HIDDEN, AFTER] = [0, 1, 2];
/** How far the disc's middle must darken, in levels of 255, for the layer to have hidden it. */
const DARKENED = 40;
/** How far a stretch's end must agree with the one before the layer arrived. */
const STEADY = 4;
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** The mean of a stretch's last captures of `place`, in levels of 255. */
function settled(frames: Capture[], stretch: number, place: 'disc' | 'plain'): number {
	const inStretch = frames.filter((frame) => frame.stretch === stretch).slice(-3);
	const mean = inStretch.map(
		(frame) =>
			((frame[place][0] as number) + (frame[place][1] as number) + (frame[place][2] as number)) / 3,
	);
	return mean.reduce((sum, value) => sum + value, 0) / mean.length;
}

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a sky layer dims the sun's disc on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto(`sky-layer-sun.html?gpu=${gpu}&fps=20`);
		const result = await pageResult<{ error?: string; tier: string; frames: Capture[] }>(
			page,
			90_000,
		);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const { frames } = result;
		const report = (stretch: number, place: 'disc' | 'plain') =>
			`${place} ${frames
				.filter((frame) => frame.stretch === stretch)
				.map((frame) => {
					const [r, g, b] = frame[place] as number[];
					return `${frame.frame}:${(((r as number) + (g as number) + (b as number)) / 3).toFixed(1)}`;
				})
				.join(' ')}`;
		const text = `${report(BEFORE, 'disc')} | ${report(HIDDEN, 'disc')} | ${report(AFTER, 'disc')}`;
		const before = settled(frames, BEFORE, 'disc');
		const hidden = settled(frames, HIDDEN, 'disc');
		const after = settled(frames, AFTER, 'disc');
		// The disc draws a bright middle before the layer, and the layer puts it out.
		expect(before, text).toBeGreaterThan(200);
		expect(before - hidden, text).toBeGreaterThan(DARKENED);
		// Removing the layer gives the sun's disc back.
		expect(Math.abs(after - before), text).toBeLessThanOrEqual(STEADY);
		// The layer covers nothing, so the plain sky beside the disc does not move.
		const plainBefore = settled(frames, BEFORE, 'plain');
		for (const stretch of [HIDDEN, AFTER])
			expect(Math.abs(settled(frames, stretch, 'plain') - plainBefore), text).toBeLessThanOrEqual(
				STEADY,
			);
	});
