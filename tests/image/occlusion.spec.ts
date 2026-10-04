// Software occlusion culling in a live engine: the occlusion cost page flies down a street of the
// city with the culling off and on in turns. On WebGL2 the buildings hide part of the city, so the
// frames with the culling on list fewer entries, and count the ones they hid; the frames with it
// off hide none. WebGPU ignores the setting and counts nothing. Each run logs the page's figures.
// In hold mode, the culling must draw the city to the pixel as it is without it, at several points
// along the street, compared on the machine that draws both.
import { expect, type Page, test } from '@playwright/test';
import { differentPixels } from '../lib/images.ts';
import { loadResult, pageResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { manifestRun } from './manifest.ts';

interface Side {
	visibleEntries: number | null;
	occludedEntries: number | null;
	intervalMs: number | null;
}

interface OcclusionResult {
	error?: string;
	tier: string;
	off: Side;
	on: Side;
	failures: string[];
}

for (const tier of ['webgl2', 'webgpu'] as const)
	test(`software occlusion culling hides what the buildings block on ${tier}`, async ({ page }) => {
		await page.goto(`occlusion-cost.html?gpu=${tier}&rounds=1&seconds=0.5&light`);
		const result = await pageResult<OcclusionResult>(page, 60_000);
		console.log(`occlusion on ${tier}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(tier);
		expect(result.failures).toEqual([]);
		const { off, on } = result;
		if (tier === 'webgpu') {
			expect([off.occludedEntries, on.occludedEntries]).toEqual([null, null]);
			return;
		}
		expect(off.occludedEntries).toBe(0);
		expect(on.occludedEntries).toBeGreaterThan(0);
		expect(on.visibleEntries).toBeLessThan(off.visibleEntries as number);
	});

/** Sketch times along the street, in seconds, from its start to near its end. */
const HOLDS = [0.5, 2.5, 6, 10, 14, 18];

/** The held city's pixels and the entries that culling hid, at a sketch time, with culling on or off. */
async function heldCity(page: Page, hold: number, side: 'on' | 'off') {
	const path = manifestRun('occlusion-off', 'webgl2', 'pipelined')
		.path.replace(/([?&]hold=)[^&]*/, `$1${hold}`)
		.replace('occlusion=off', `occlusion=${side}`);
	const result = await loadResult(page, path, 30_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	// The figures cover every step of the hold, which ends at this time.
	const occluded = await page.evaluate(
		() =>
			(globalThis as { __null3dHold?: { stats: { occludedEntries: { p99: number } | null } } })
				.__null3dHold?.stats.occludedEntries?.p99 ?? 0,
	);
	return { pixels: Buffer.from(result.pixels as string, 'base64'), occluded };
}

test('software occlusion culling draws the city to the pixel as it is without it on webgl2', async ({
	page,
}) => {
	test.setTimeout(HOLDS.length * 2 * 40_000);
	const found: string[] = [];
	for (const hold of HOLDS) {
		const off = await heldCity(page, hold, 'off');
		const on = await heldCity(page, hold, 'on');
		if (on.occluded === 0) found.push(`at ${hold} s the culling hid nothing`);
		const count = differentPixels(off.pixels, on.pixels);
		if (count > 0) found.push(`at ${hold} s, ${count} pixels differ with the culling on`);
	}
	expect(found).toEqual([]);
});
