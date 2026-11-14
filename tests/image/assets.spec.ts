// The sketch's loading and texture calls in a live engine, in every thread mode: files by addresses
// relative to the page, preloads whose progress reports the bytes that arrive, textures from images
// and data that change size and texels, and the codes of the calls that fail. Two addresses of other
// origins answer from the test itself: one allows the page to read its file, and one allows another
// site only. A third answer gives no length, so the bytes that arrive have no total to rise to.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems, type ReportedMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';

interface Recorded {
	preloaded: [number, number, string][];
	reportsAfterPreload: number;
	progress: [number, number, string][];
	streamedBytes: number;
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
const WEBP = readFileSync(join(ASSETS, 'textures/quadrants.webp'));
const LEVEL = readFileSync(join(ASSETS, 'data/level.json'));
/** The files that the sketch preloads, by their path from the test page. */
const PRELOADED = [
	'/tests/pages/assets/textures/quadrants.png',
	'/tests/pages/assets/textures/quadrants.webp',
	'/tests/pages/assets/data/level.json',
];
/** The bytes of the answer that gives no length. */
const STREAM_BYTES = 4096;

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
			// An empty length stands for a response that announces none, which Playwright would
			// otherwise give for the body it fulfils.
			await page
				.context()
				.route('**/assets/data/stream.bin', (route) =>
					route.fulfill({ body: Buffer.alloc(STREAM_BYTES, 7), headers: { 'content-length': '' } }),
				);
			await page.goto(`assets.html?gpu=${gpu}&${mode.query}`);
			const result = await pageResult<AssetsResult>(page, 60_000);
			expect(result.error).toBeUndefined();
			expect(modeProblems(result.mode, mode)).toEqual([]);
			const recorded = result.recorded;

			// The preload reports the bytes of its three files as they arrive, and each response's
			// length adds to the total. How the server splits a body into chunks changes the reports
			// in between, never the counts that it reaches.
			expect(recorded.preloaded.length).toBeGreaterThanOrEqual(PRELOADED.length);
			const reported = [
				...new Set(recorded.preloaded.map(([, , url]) => new URL(url).pathname)),
			].sort();
			expect(reported).toEqual([...PRELOADED].sort());
			const [preloadLoaded, preloadTotal] = recorded.preloaded.at(-1) ?? [0, 0];
			expect(preloadLoaded).toBe(PICTURE.length + WEBP.length + LEVEL.length);
			// Each response's length counts before its body, so the total is at least the bytes
			// downloaded at every report, and every length has arrived when the preload ends.
			expect(recorded.preloaded.every(([bytes, expected]) => expected >= bytes)).toBe(true);
			expect(preloadTotal).toBe(preloadLoaded);
			// The loads that follow take their files from memory, and report no download.
			expect(recorded.reportsAfterPreload).toBe(0);

			// A response that gives no length reports the bytes that arrive, and leaves the total at
			// the lengths that other responses announced.
			const streamed = recorded.progress.filter(([, , url]) =>
				url.endsWith('/assets/data/stream.bin'),
			);
			expect(streamed.length).toBeGreaterThan(0);
			expect(streamed.every(([, total]) => total === preloadTotal)).toBe(true);
			expect(streamed.at(-1)?.[0]).toBe(preloadTotal + STREAM_BYTES);
			expect(recorded.streamedBytes).toBe(STREAM_BYTES);

			// Every report adds its bytes to the counts, so neither count ever falls, and the bytes
			// downloaded end at least at the bytes expected, above them by the answer whose length
			// never arrived.
			for (let at = 1; at < recorded.progress.length; at++) {
				const previous = recorded.progress[at - 1] as [number, number, string];
				const current = recorded.progress[at] as [number, number, string];
				expect(current[0]).toBeGreaterThanOrEqual(previous[0]);
				expect(current[1]).toBeGreaterThanOrEqual(previous[1]);
			}
			const [loaded, total] = recorded.progress.at(-1) ?? [0, 0];
			expect(loaded).toBeGreaterThanOrEqual(total);

			expect(recorded.enemies).toBe(3);
			expect(recorded.bytes).toBe(LEVEL.length);

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
