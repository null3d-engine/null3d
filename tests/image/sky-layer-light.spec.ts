// A sky layer reaches both places that a sky is seen: the texels of the sky's environment map, which
// the mirror sphere reflects, and the diffuse light that the map gives the scene, which lights the
// rough sphere. The sky layer light sketch draws both spheres under a sky with no light of its own,
// installs a green layer, and later removes it. This test reads the spheres' colors in every capture
// and checks that each shows the layer, that each loses it, and that neither shows it while the
// other does not for more than the few frames that the light takes to follow the map.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Capture {
	stretch: number;
	frame: number;
	mirror: number[];
	rough: number[];
}

/** The stretch of the captures with no layer, with one, and after it was removed. */
const [BEFORE, WITH, AFTER] = [0, 1, 2];
/** The change of a color that counts as the layer's, in levels of 255. */
const CHANGE = 15;
/** The frames that the diffuse light may take to follow what the map shows. */
const LAG = 4;
/** How far the captures at the end of a stretch must agree, in levels of 255. */
const STEADY = 3;
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** How green a color is: the green above the mean of red and blue, in levels of 255. */
const green = (color: number[]) =>
	(color[1] as number) - ((color[0] as number) + (color[2] as number)) / 2;

/** The mean of a stretch's last few captures of `place`. */
function settled(frames: Capture[], stretch: number, place: 'mirror' | 'rough'): number[] {
	const inStretch = frames.filter((frame) => frame.stretch === stretch);
	const last = inStretch.slice(-4);
	return [0, 1, 2].map(
		(c) => last.reduce((sum, frame) => sum + (frame[place][c] as number), 0) / last.length,
	);
}

/** The frame of a stretch at which `place` has taken half of its change from `before` to `after`. */
function crossing(
	frames: Capture[],
	place: 'mirror' | 'rough',
	before: number,
	after: number,
): number {
	const half = (before + after) / 2;
	const inStretch = frames.filter((frame) => frame.stretch === WITH);
	const found = inStretch.find(
		(frame) => Math.abs(green(frame[place]) - before) >= Math.abs(half - before),
	);
	return found?.frame ?? -1;
}

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a sky layer reaches the reflections and the light on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto(`sky-layer-light.html?gpu=${gpu}&fps=20`);
		const result = await pageResult<{ error?: string; tier: string; frames: Capture[] }>(
			page,
			90_000,
		);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const { frames } = result;
		const report = (stretch: number, place: 'mirror' | 'rough') => {
			const line = frames
				.filter((frame) => frame.stretch === stretch)
				.map((frame) => `${frame.frame}:${green(frame[place]).toFixed(1)}`)
				.join(' ');
			return `${place} ${line}`;
		};
		const places = ['mirror', 'rough'] as const;
		const greens: Record<(typeof places)[number], [number, number, number]> = {
			mirror: [0, 0, 0],
			rough: [0, 0, 0],
		};
		for (const place of places) {
			const before = green(settled(frames, BEFORE, place));
			const withLayer = green(settled(frames, WITH, place));
			const after = green(settled(frames, AFTER, place));
			greens[place] = [before, withLayer, after];
			const text = `${report(BEFORE, place)} | ${report(WITH, place)} | ${report(AFTER, place)}`;
			// The layer's green shows, and it goes again: both places take it and lose it.
			expect(withLayer - before, text).toBeGreaterThan(CHANGE);
			expect(Math.abs(after - before), text).toBeLessThanOrEqual(STEADY);
			// The stretch settles, so the captures at its end are the settled light.
			const lastTwo = frames.filter((frame) => frame.stretch === WITH).slice(-2);
			for (const frame of lastTwo)
				expect(Math.abs(green(frame[place]) - withLayer), text).toBeLessThanOrEqual(STEADY);
		}
		// Neither place shows the layer while the other does not, beyond the few frames that the
		// light takes to follow the map that the reflections read at once.
		const crossed = {
			mirror: crossing(frames, 'mirror', greens.mirror[0], greens.mirror[1]),
			rough: crossing(frames, 'rough', greens.rough[0], greens.rough[1]),
		};
		expect(crossed.mirror, JSON.stringify(greens)).toBeGreaterThanOrEqual(0);
		expect(crossed.rough, JSON.stringify(greens)).toBeGreaterThanOrEqual(0);
		expect(Math.abs(crossed.mirror - crossed.rough), JSON.stringify(crossed)).toBeLessThanOrEqual(
			LAG,
		);
	});
