// Depth precision beyond what the image test manifest checks, with the manifest's depth precision
// pages. On a real GPU, reversed depth tells the surfaces apart at every distance. SwiftShader, the
// software GPU of the CI machines, loses precision past 100 m even there, but less than in standard
// depth, as every GPU must. Every thread mode draws the depth mode that ?depth= asks for.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText, type ItemResult } from '../lib/runs.ts';
import type { PrecisionFacts } from '../pages/lib/depth-precision.ts';
import { manifestRun } from './manifest.ts';

type DepthResult = ItemResult & PrecisionFacts & { depth: string; clipControl: boolean };

/** Opens a depth precision page and returns its result, which must have no error. */
async function draw(page: Page, path: string): Promise<DepthResult> {
	const result = await loadResult(page, path, 30_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	return result as DepthResult;
}

/** The distance and fighting pixels of each tile that fights, which a failure prints. */
const fightingTiles = ({ tiles }: PrecisionFacts) =>
	tiles
		.filter(({ fighting }) => fighting > 0)
		.map(({ distance, fighting }) => [distance, fighting]);

test('reversed depth tells the surfaces apart on a real GPU, and fights less than standard depth', async ({
	page,
}, testInfo) => {
	const reversed = await draw(page, manifestRun('depth-precision-reversed', 'webgl2').path);
	test.skip(!reversed.clipControl, 'this browser has no EXT_clip_control');
	const webgpu = await draw(page, manifestRun('depth-precision', 'webgpu').path);
	const standard = await draw(page, manifestRun('depth-precision-standard', 'webgl2').path);
	if (testInfo.project.name === 'chrome-real-gpu')
		expect([fightingTiles(reversed), fightingTiles(webgpu)]).toEqual([[], []]);
	expect(reversed.fighting).toBeLessThan(standard.fighting);
	expect(webgpu.fighting).toBeLessThan(standard.fighting);
});

test('every thread mode draws the depth mode that ?depth= asks for, with the same fighting pixels', async ({
	page,
}) => {
	const path = manifestRun('depth-precision-standard', 'webgl2').path;
	let first: PrecisionFacts['tiles'] | undefined;
	for (const mode of ENGINE_MODES) {
		const result = await draw(page, mode.query ? `${path}&${mode.query}` : path);
		expect([mode.name, result.depth]).toEqual([mode.name, 'standard']);
		first ??= result.tiles;
		expect([mode.name, result.tiles]).toEqual([mode.name, first]);
	}
});
