// The sketch's loading and texture calls in a live engine, in every thread mode: files by addresses
// relative to the page, preloads with their progress in order, textures from images and data that
// change size and texels, and the codes of the calls that fail. Two addresses of other origins
// answer from the test itself: one allows the page to read its file, and one allows another site
// only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems, type ReportedMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';

interface Recorded {
	preloaded: [number, number][];
	downloadsAfterPreload: number;
	progress: [number, number][];
	enemies: number;
	bytes: number;
	sizes: number[][];
	textureBytes: number[];
	memoryBytes: number;
	maxSize: number;
	formats: string[];
	codes: Record<string, string>;
}

interface AssetsResult {
	error?: string;
	mode: ReportedMode;
	recorded: Recorded;
}

const ASSETS = join(REPO_ROOT, 'tests/pages/assets');
const PICTURE = readFileSync(join(ASSETS, 'textures/quadrants.png'));

/** The GPU bytes of a layer of `width` x `height` RGBA8 texels, with `mips` mip levels. */
function layerBytes(width: number, height: number, mips: number): number {
	let bytes = 0;
	for (let level = 0; level < mips; level++)
		bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * 4;
	return bytes;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`the sketch loads files and makes textures, on ${gpu}, ${mode.name}`, async ({ page }) => {
			await page.context().route('http://allowed.null3d.test/**', (route) =>
				route.fulfill({
					body: PICTURE,
					contentType: 'image/png',
					headers: { 'Access-Control-Allow-Origin': '*' },
				}),
			);
			// Playwright gives a fulfilled response of another origin a header that allows the page,
			// unless it has one, so this one allows another site instead.
			await page.context().route('http://blocked.null3d.test/**', (route) =>
				route.fulfill({
					body: PICTURE,
					contentType: 'image/png',
					headers: { 'Access-Control-Allow-Origin': 'https://another-site.null3d.test' },
				}),
			);
			await page.goto(`assets.html?gpu=${gpu}&${mode.query}`);
			const result = await pageResult<AssetsResult>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(modeProblems(result.mode, mode)).toEqual([]);
			const recorded = result.recorded;

			// The preload counts its three files in order, and the loads that follow take them from
			// memory. Every later download counts, failed ones too, one after another.
			expect(recorded.preloaded).toEqual([
				[1, 3],
				[2, 3],
				[3, 3],
			]);
			expect(recorded.downloadsAfterPreload).toBe(3);
			expect(recorded.progress).toEqual(
				Array.from({ length: 11 }, (_, k) => [k + 1, k < 3 ? 3 : k + 1]),
			);
			expect(recorded.enemies).toBe(3);
			expect(recorded.bytes).toBe(readFileSync(join(ASSETS, 'data/level.json')).length);

			// The picture, the one of the other origin, the one from a bitmap, three layers of data,
			// half floats, and data that took the picture's size.
			expect(recorded.sizes).toEqual([
				[64, 64, 1],
				[64, 64, 1],
				[64, 64, 1],
				[2, 2, 3],
				[2, 1, 1],
				[64, 64, 1],
			]);
			const mipped = layerBytes(64, 64, 7);
			const flat = layerBytes(64, 64, 1);
			expect(recorded.textureBytes).toEqual([mipped, mipped, flat, 3 * 16, 2 * 8, flat]);
			// Each array of 64 x 64 texels holds four layers; the layers of data have their own.
			expect(recorded.memoryBytes).toBe(8 * mipped + 8 * flat + 3 * 16 + 4 * 16);
			expect(recorded.maxSize).toBeGreaterThanOrEqual(2048);
			expect(recorded.formats).toEqual(['rgba16float', 'linear', 'srgb', 'linear']);
			expect(recorded.codes).toEqual({
				missing: 'E1411',
				blocked: 'E1413',
				notAnImage: 'E1412',
				notJson: 'E1412',
				badOption: 'E1208',
				shortData: 'E1208',
				destroyed: 'E1101',
			});
		});
