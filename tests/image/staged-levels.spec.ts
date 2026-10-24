// Staged levels of detail: a model whose file holds its coarsest level and whose finer levels
// download from files of their own (tests/pages/staged-levels.ts). The spec holds each stage file
// back until the page says that it captured the picture that the file itself draws. So the first
// picture is the coarse level that arrives with the model, and the second is the same copies drawn
// with every level that the stages brought. The two pictures must differ over a real share of the
// image, and both must draw the ground, on every GPU path.
//
// The last test proves that the first picture is the file's own level rather than a finer one that
// the stages had already brought: it compares that picture with the picture that the loader's level
// limit of 1 draws, which downloads no stage at all. The two must be the same picture. It also
// checks that the limit makes the page request no stage file.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface StagedResult {
	tier: string;
	loaded: { levels: number; staged: boolean };
	/** The stages that the model names. */
	expected: number;
	levels: number;
	size: [number, number];
	/** The share of the pixels that the picture with the stages differs in. */
	changed: number;
	/** The share of the coarse picture that draws over its background. */
	drawn: number;
	/** The picture before the stages arrived, and the picture after them, as base64 RGBA. */
	coarsePixels: string;
	finePixels: string;
	failures: string[];
}

/** The share of the pixels in which two pictures of one size differ. */
function differing(a: string, b: string): number {
	const one = Buffer.from(a, 'base64');
	const other = Buffer.from(b, 'base64');
	expect(other.length).toBe(one.length);
	let different = 0;
	for (let at = 0; at < one.length; at += 4)
		if (
			one.readUInt32LE(at) !== other.readUInt32LE(at) &&
			// A pixel counts only when a channel differs by more than the comparison's threshold.
			Math.max(
				Math.abs((one[at] as number) - (other[at] as number)),
				Math.abs((one[at + 1] as number) - (other[at + 1] as number)),
				Math.abs((one[at + 2] as number) - (other[at + 2] as number)),
			) > 13
		)
			different += 1;
	return different / (one.length / 4);
}

/** Asserts the staged run's checks, which every path runs. */
function expectStaged(result: StagedResult) {
	expect(result.failures).toEqual([]);
	expect(result.loaded).toEqual({ levels: 0, staged: true });
	// Every stage arrived and became a level of the mesh.
	expect(result.levels).toBe(result.expected);
	expect(result.expected).toBeGreaterThan(0);
	// Both pictures draw the ground, and the stages changed a real share of the pixels.
	expect(result.drawn).toBeGreaterThan(0.4);
	expect(result.changed).toBeGreaterThan(0.01);
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`staged-levels draw the coarse level first and the fine one after, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		/** The stage files' answers, which wait for the coarse picture. */
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let held = 0;
		await page.route(/\.m\d+\.lod\d+\.bin$/, async (route) => {
			held += 1;
			await gate;
			await route.continue();
		});
		await page.goto(`staged-levels.html?gpu=${gpu}`);
		await page.waitForFunction(() => (globalThis as { __stagedCoarse?: boolean }).__stagedCoarse);
		expect(held).toBeGreaterThan(0);
		release?.();
		const result = await pageResult<StagedResult>(page, 120_000);
		expectStaged(result);
	});

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`staged-levels drop the stages that the camera never draws, on ${gpu}`, async ({ page }) => {
		test.setTimeout(240_000);
		/** The stage files that the page asked for. */
		const asked = new Set<string>();
		page.on('request', (request) => {
			if (/\.m\d+\.lod\d+\.bin$/.test(request.url())) asked.add(request.url());
		});
		/** The stage files' answers, which wait for the coarse picture. */
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(/\.m\d+\.lod\d+\.bin$/, async (route) => {
			await gate;
			await route.continue();
		});
		await page.goto(`staged-levels.html?gpu=${gpu}&far`);
		await page.waitForFunction(() => (globalThis as { __stagedCoarse?: boolean }).__stagedCoarse);
		release?.();
		const far = await pageResult<StagedResult>(page, 180_000);
		expect(far.failures).toEqual([]);
		expect(far.expected).toBeGreaterThan(2);
		// The stage after the file's own level always arrives. The level it brings never draws at
		// this camera, so the loader drops the stage after it, and every finer one, without asking
		// for their files.
		expect(far.loaded).toEqual({ levels: 0, staged: true });
		expect(far.levels).toBe(1);
		expect(asked.size).toBe(1);
		// The level that arrived never drew, so both pictures show the file's own level.
		expect(differing(far.coarsePixels, far.finePixels)).toBeLessThan(0.001);
	});

test("staged-levels draws the file's own level first, and a level limit downloads no stage", async ({
	page,
}) => {
	test.setTimeout(240_000);
	/** The stage files' answers, which wait for the coarse picture. */
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(/\.m\d+\.lod\d+\.bin$/, async (route) => {
		await gate;
		await route.continue();
	});
	await page.goto('staged-levels.html?gpu=webgpu');
	await page.waitForFunction(() => (globalThis as { __stagedCoarse?: boolean }).__stagedCoarse);
	release?.();
	const staged = await pageResult<StagedResult>(page, 120_000);
	expectStaged(staged);
	// The level limit of 1 downloads no stage. Its picture is the level that the file holds, so it
	// must be the picture that the staged run drew before any stage arrived.
	const stages: string[] = [];
	page.on('request', (request) => {
		if (/\.m\d+\.lod\d+\.bin$/.test(request.url())) stages.push(request.url());
	});
	await page.goto('staged-levels.html?gpu=webgpu&max=1');
	const limited = await pageResult<StagedResult>(page, 120_000);
	expect(limited.failures).toEqual([]);
	expect(limited.loaded).toEqual({ levels: 0, staged: false });
	expect(limited.expected).toBeGreaterThan(0);
	expect(limited.levels).toBe(0);
	expect(stages).toEqual([]);
	expect(limited.drawn).toBeGreaterThan(0.4);
	expect(limited.changed).toBeLessThan(0.001);
	// The two runs drew the file's own level, so their pictures agree, and the stages of the first
	// run changed its picture away from that level.
	expect(differing(limited.finePixels, staged.coarsePixels)).toBeLessThan(0.001);
	expect(differing(limited.finePixels, staged.finePixels)).toBeGreaterThan(0.01);
});
