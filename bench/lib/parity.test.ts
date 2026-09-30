import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { decode } from 'fast-png';
import {
	BENCH_SCENES,
	compareFrames,
	compareImages,
	comparisonName,
	decodeHoldResult,
	differenceText,
	formatStoredBaselines,
	gpuApiOf,
	gpuApiOfPage,
	type HoldFrame,
	holdPagePath,
	isNull3dPage,
	JOBS_PAGES,
	LEFT_OUT_OF_PARITY,
	MAX_DIFFERENT_PERCENT,
	PAGE_KINDS,
	PARITY_SCENES,
	PIXEL_THRESHOLD,
	pagePath,
	parityFiles,
	parseParityArgs,
	parseStoredBaselines,
	passesWithBaseline,
	type RgbaImage,
	readJobCounts,
	TIER_PAIRS,
	TIERS,
} from './parity';

/** An opaque image of one color. */
function solid(width: number, height: number, rgb: readonly [number, number, number]): RgbaImage {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
	return { width, height, data };
}

/** A copy of an image with the pixels in a rectangle set to one RGBA color. */
function paint(
	image: RgbaImage,
	x: number,
	y: number,
	width: number,
	height: number,
	rgba: readonly number[],
): RgbaImage {
	const data = image.data.slice();
	for (let row = y; row < y + height; row++)
		for (let column = x; column < x + width; column++)
			data.set(rgba, (row * image.width + column) * 4);
	return { ...image, data };
}

function pixelAt(image: RgbaImage, x: number, y: number): number[] {
	const i = (y * image.width + x) * 4;
	return [...image.data.subarray(i, i + 4)];
}

/** A hold page's published result for an image, as the pages publish it. */
function holdResult(
	image: RgbaImage,
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		ok: true,
		scene: 's1',
		renderer: 'webgl',
		n: 1000,
		width: image.width,
		height: image.height,
		pixels: Buffer.from(image.data).toString('base64'),
		...extra,
	};
}

const GRAY = [100, 100, 100] as const;

describe('the comparison rule', () => {
	test("uses three.js's numbers", () => {
		expect(PIXEL_THRESHOLD).toBe(0.1);
		expect(MAX_DIFFERENT_PERCENT).toBe(0.1);
	});

	test('passes identical images', () => {
		const image = solid(64, 64, GRAY);
		expect(compareImages(image, { ...image, data: image.data.slice() })).toMatchObject({
			differentPixels: 0,
			share: 0,
			pass: true,
		});
	});

	test('passes a one-pixel change', () => {
		const image = solid(64, 64, GRAY);
		const result = compareImages(image, paint(image, 10, 20, 1, 1, [255, 255, 255, 255]));
		expect(result).toMatchObject({ differentPixels: 1, share: 1 / 4096, pass: true });
	});

	test('fails a changed region', () => {
		const image = solid(64, 64, GRAY);
		const result = compareImages(image, paint(image, 8, 8, 8, 8, [255, 0, 255, 255]));
		expect(result).toMatchObject({ differentPixels: 64, share: 64 / 4096, pass: false });
	});

	test('passes only when strictly under the share limit', () => {
		// 10,000 pixels: 9 is 0.09% of them and 10 is exactly the limit.
		const image = solid(1000, 10, GRAY);
		const white = [255, 255, 255, 255];
		expect(compareImages(image, paint(image, 0, 0, 9, 1, white)).pass).toBe(true);
		expect(compareImages(image, paint(image, 0, 0, 10, 1, white)).pass).toBe(false);
	});

	test('counts a pixel only when its RGB distance is over the threshold', () => {
		// The threshold is a tenth of the distance from black to white: one channel may move by 44
		// but not 45, and all three together by 25 but not 26.
		const image = solid(4, 1, GRAY);
		const moved = (by: readonly [number, number, number]) =>
			paint(image, 0, 0, 1, 1, [GRAY[0] + by[0], GRAY[1] + by[1], GRAY[2] + by[2], 255]);
		expect(compareImages(image, moved([44, 0, 0])).differentPixels).toBe(0);
		expect(compareImages(image, moved([0, 45, 0])).differentPixels).toBe(1);
		expect(compareImages(image, moved([25, 25, 25])).differentPixels).toBe(0);
		expect(compareImages(image, moved([26, 26, 26])).differentPixels).toBe(1);
		expect(compareImages(image, moved([0, 0, -45])).differentPixels).toBe(1);
	});

	test('ignores alpha', () => {
		const image = solid(4, 4, GRAY);
		expect(compareImages(image, paint(image, 0, 0, 4, 4, [...GRAY, 0])).differentPixels).toBe(0);
	});

	test('marks the changed pixels red in the diff image and dims the reference elsewhere', () => {
		const reference = solid(8, 4, [200, 150, 11]);
		const { diff } = compareImages(reference, paint(reference, 2, 1, 3, 2, [0, 0, 0, 255]));
		expect([diff.width, diff.height]).toEqual([8, 4]);
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 8; x++) {
				const changed = x >= 2 && x < 5 && y >= 1 && y < 3;
				// A matching pixel keeps a fifth of the reference's value, rounded down.
				expect(pixelAt(diff, x, y)).toEqual(changed ? [255, 0, 0, 255] : [40, 30, 2, 255]);
			}
		}
	});

	test('refuses images of different sizes', () => {
		expect(() => compareImages(solid(4, 4, GRAY), solid(4, 5, GRAY))).toThrow(
			'the images differ in size: 4 x 4 and 4 x 5',
		);
		expect(() => compareImages(solid(4, 4, GRAY), solid(5, 4, GRAY))).toThrow(RangeError);
	});

	test('refuses an image whose pixels do not fill its size', () => {
		const short = { width: 4, height: 4, data: new Uint8Array(60) };
		expect(() => compareImages(solid(4, 4, GRAY), short)).toThrow(
			'the candidate image holds 60 bytes, not the 64 that 4 x 4 RGBA8 pixels need',
		);
	});
});

describe('decodeHoldResult', () => {
	test("reads a published result's pixels and what the page drew", () => {
		const image = paint(solid(3, 2, GRAY), 1, 1, 1, 1, [1, 2, 3, 4]);
		const frame = decodeHoldResult(holdResult(image, { scene: 's2', n: 5096 }));
		expect(frame).toMatchObject({ scene: 's2', n: 5096, width: 3, height: 2 });
		expect([...frame.data]).toEqual([...image.data]);
	});

	test("refuses a failed page with the page's own error", () => {
		expect(() => decodeHoldResult({ ok: false, error: 'This browser has no WebGPU.' })).toThrow(
			'This browser has no WebGPU.',
		);
		expect(() => decodeHoldResult({ ok: false })).toThrow('the page failed without a message');
		expect(() => decodeHoldResult(undefined)).toThrow('the page published no result object');
	});

	test('refuses a result that is not a whole frame', () => {
		const image = solid(3, 2, GRAY);
		expect(() => decodeHoldResult(holdResult(image, { height: 3 }))).toThrow(
			'the frame holds 24 bytes, not the 36 that 3 x 3 RGBA8 pixels need',
		);
		expect(() => decodeHoldResult(holdResult(image, { width: 0 }))).toThrow(
			'the frame has no valid size: 0 x 2',
		);
		expect(() => decodeHoldResult(holdResult(image, { pixels: undefined }))).toThrow(
			'the result has no pixels',
		);
		expect(() => decodeHoldResult(holdResult(image, { n: undefined }))).toThrow(
			'the result has no valid object count',
		);
		expect(() => decodeHoldResult(holdResult(image, { scene: 1 }))).toThrow(
			'the result does not name its scene',
		);
	});
});

describe('compareFrames', () => {
	const frame = (extra: Partial<HoldFrame> = {}): HoldFrame => ({
		...solid(4, 4, GRAY),
		scene: 's1',
		n: 1000,
		...extra,
	});

	test('compares frames of the same scene and object count', () => {
		expect(compareFrames(frame(), frame()).pass).toBe(true);
	});

	test('refuses frames of different scenes or object counts', () => {
		expect(() => compareFrames(frame({ n: 10 }), frame())).toThrow(
			'the pages drew different object counts: 10 and 1000',
		);
		expect(() => compareFrames(frame({ scene: 's2' }), frame())).toThrow(
			'the pages drew different scenes: s2 and s1',
		);
	});
});

describe('parityFiles', () => {
	test('saves both frames side by side, candidate first, and the diff image, as PNG', () => {
		const candidate = solid(3, 2, [255, 0, 0]);
		const reference = solid(3, 2, [0, 0, 255]);
		const { diff } = compareImages(reference, candidate);
		const files = parityFiles('s1-a-vs-b', candidate, reference, diff);
		expect(files.map(({ file }) => file)).toEqual(['s1-a-vs-b-inputs.png', 's1-a-vs-b-diff.png']);

		const inputs = decode(files[0]!.png);
		expect([inputs.width, inputs.height, inputs.channels, inputs.depth]).toEqual([6, 2, 4, 8]);
		const inputImage = { width: 6, height: 2, data: inputs.data as Uint8Array };
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 6; x++) {
				expect(pixelAt(inputImage, x, y)).toEqual(x < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
			}
		}
		const diffPng = decode(files[1]!.png);
		expect([diffPng.width, diffPng.height]).toEqual([3, 2]);
		expect([...(diffPng.data as Uint8Array)]).toEqual([...diff.data]);
	});
});

describe('the scenes', () => {
	test('every benchmark scene has a null3D page, a three.js twin and a scene-code page', () => {
		const root = join(import.meta.dirname, '../..');
		for (const scene of BENCH_SCENES)
			for (const kind of ['null3d-webgpu', 'threejs-webgl', 'scene-code'] as const)
				expect(existsSync(join(root, pagePath(scene, kind).split('?')[0] as string))).toBe(true);
	});

	test('compares with three.js the scenes that both engines draw in full', () => {
		expect(PARITY_SCENES).toEqual(['s1', 's1-static', 's1-cells', 's2']);
		for (const scene of BENCH_SCENES)
			expect(PARITY_SCENES.includes(scene)).toBe(LEFT_OUT_OF_PARITY[scene].length === 0);
	});
});

describe('the pages', () => {
	test('each hold page lives in its engine folder with its GPU switch and hold mode', () => {
		expect(holdPagePath('s1', 'threejs-webgl')).toBe(
			'/bench/pages/threejs/s1.html?renderer=webgl&hold',
		);
		expect(holdPagePath('s1-static', 'threejs-webgpu')).toBe(
			'/bench/pages/threejs/s1-static.html?renderer=webgpu&hold',
		);
		expect(holdPagePath('s2', 'null3d-webgl2')).toBe('/bench/pages/null3d/s2.html?gpu=webgl2&hold');
		expect(holdPagePath('s2', 'null3d-webgpu')).toBe('/bench/pages/null3d/s2.html?gpu=webgpu&hold');
		expect(holdPagePath('s1', 'null3d-compat')).toBe('/bench/pages/null3d/s1.html?gpu=compat&hold');
		expect(pagePath('s1', 'scene-code', 'n=1000')).toBe('/bench/pages/scene-code/s1.html?n=1000');
	});

	test('pairs the null3D page with the three.js page of the same GPU interface', () => {
		expect(TIER_PAIRS).toEqual({
			webgpu: { candidate: 'null3d-webgpu', reference: 'threejs-webgpu' },
			compat: { candidate: 'null3d-compat', reference: 'threejs-webgpu' },
			webgl2: { candidate: 'null3d-webgl2', reference: 'threejs-webgl' },
		});
		expect(PAGE_KINDS).toEqual([
			'threejs-webgl',
			'threejs-webgpu',
			'null3d-webgl2',
			'null3d-webgpu',
			'null3d-compat',
			'null3d-webgpu-low',
			'null3d-webgl2-low',
			'null3d-webgpu-cells-off',
			'null3d-webgl2-cells-off',
		]);
		expect(TIERS.map(gpuApiOf)).toEqual(['webgpu', 'webgpu', 'webgl2']);
	});

	test('runs the low-latency pages on the pipelined pages with the latency switch', () => {
		expect(pagePath('s1', 'null3d-webgpu-low', 'seconds=2')).toBe(
			'/bench/pages/null3d/s1.html?gpu=webgpu&latency=low&seconds=2',
		);
		expect(pagePath('s2', 'null3d-webgl2-low')).toBe(
			'/bench/pages/null3d/s2.html?gpu=webgl2&latency=low',
		);
		// Low latency changes when a frame draws, not what it draws, so parity needs no pair for it.
		const candidates = Object.values(TIER_PAIRS).map(({ candidate }) => candidate);
		expect(candidates).not.toContain('null3d-webgpu-low');
		expect(candidates).not.toContain('null3d-webgl2-low');
	});

	test('runs the pages without cell culling on the pipelined pages with the cells switch', () => {
		expect(pagePath('s1-cells', 'null3d-webgl2-cells-off', 'seconds=2')).toBe(
			'/bench/pages/null3d/s1-cells.html?gpu=webgl2&cells=off&seconds=2',
		);
		expect(pagePath('s1-cells', 'null3d-webgpu-cells-off')).toBe(
			'/bench/pages/null3d/s1-cells.html?gpu=webgpu&cells=off',
		);
	});

	test('sweeps job worker counts on the null3D pages only', () => {
		expect(JOBS_PAGES).toEqual(['null3d-webgpu', 'null3d-webgl2']);
		expect(PAGE_KINDS.filter(isNull3dPage)).toEqual([
			'null3d-webgl2',
			'null3d-webgpu',
			'null3d-compat',
			'null3d-webgpu-low',
			'null3d-webgl2-low',
			'null3d-webgpu-cells-off',
			'null3d-webgl2-cells-off',
		]);
		expect(isNull3dPage('scene-code')).toBe(false);
		expect(PAGE_KINDS.map(gpuApiOfPage)).toEqual([
			'webgl2',
			'webgpu',
			'webgl2',
			'webgpu',
			'webgpu',
			'webgpu',
			'webgl2',
			'webgpu',
			'webgl2',
		]);
		expect(gpuApiOfPage('scene-code')).toBe('webgl2');
		expect(readJobCounts('1,2,4,8,16')).toEqual([1, 2, 4, 8, 16]);
		expect(readJobCounts('4,2,4')).toEqual([4, 2]);
		for (const text of [undefined, '', '0', '2,x', '1.5', '-1'])
			expect(() => readJobCounts(text)).toThrow(
				'--jobs: use a comma-separated list of whole numbers above 0, such as 1,2,4,8',
			);
	});

	test('names the image files after the scene and the two pages', () => {
		expect(comparisonName('s1-static', TIER_PAIRS.webgl2)).toBe(
			's1-static-null3d-webgl2-vs-threejs-webgl',
		);
		expect(differenceText({ share: 0.020416 })).toBe(
			"2.042% of pixels differ; three.js's rule allows under 0.1%",
		);
	});
});

describe('stored baselines', () => {
	test('round-trip through their file text in scene order, keeping only shares of known scenes', () => {
		const text = formatStoredBaselines({ s2: 0.00332, s1: 0.04372 });
		expect(Object.keys(JSON.parse(text).scenes)).toEqual(['s1', 's2']);
		expect(parseStoredBaselines(text)).toEqual({ s1: 0.04372, s2: 0.00332 });
		expect(
			parseStoredBaselines(JSON.stringify({ scenes: { s1: 2, 's1-static': 'x', s9: 0.1 } })),
		).toEqual({});
		expect(parseStoredBaselines('{}')).toEqual({});
	});
});

describe('parseParityArgs', () => {
	test('compares every scene on every GPU tier by default', () => {
		expect(parseParityArgs([])).toEqual({
			scenes: ['s1', 's1-static', 's1-cells', 's2'],
			comparisons: [
				{ label: 'webgpu', candidate: 'null3d-webgpu', reference: 'threejs-webgpu' },
				{ label: 'compat', candidate: 'null3d-compat', reference: 'threejs-webgpu' },
				{ label: 'webgl2', candidate: 'null3d-webgl2', reference: 'threejs-webgl' },
			],
			saveBaselines: false,
		});
	});

	test('reads scenes and tiers as lists, and skips the separator that bun run passes', () => {
		expect(parseParityArgs(['--', '--scene', 's2,s1', '--tier', 'webgl2'])).toEqual({
			scenes: ['s2', 's1'],
			comparisons: [{ label: 'webgl2', candidate: 'null3d-webgl2', reference: 'threejs-webgl' }],
			saveBaselines: false,
		});
		expect(parseParityArgs(['--save-baselines']).saveBaselines).toBe(true);
	});

	test('compares any two kinds of page with --pair, the second one being the reference', () => {
		expect(parseParityArgs(['--pair', 'threejs-webgl,threejs-webgpu'])).toEqual({
			scenes: ['s1', 's1-static', 's1-cells', 's2'],
			comparisons: [
				{
					label: 'threejs-webgl vs threejs-webgpu',
					candidate: 'threejs-webgl',
					reference: 'threejs-webgpu',
				},
			],
			saveBaselines: false,
		});
	});

	test('compares a scene whose features null3D does not all draw yet only when asked', () => {
		expect(parseParityArgs([]).scenes).not.toContain('s3');
		expect(parseParityArgs(['--scene', 's3']).scenes).toEqual(['s3']);
	});

	test('refuses unknown names, a pair that is not two pages, and --tier with --pair', () => {
		expect(() => parseParityArgs(['--scene', 's9'])).toThrow(
			'"s9" is not a scene. Use one of: s1, s1-static, s1-cells, s2, s3.',
		);
		expect(() => parseParityArgs(['--tier', 'webgl1'])).toThrow('"webgl1" is not a tier.');
		expect(() => parseParityArgs(['--pair', 'threejs-webgl'])).toThrow(
			'--pair needs two different page kinds',
		);
		expect(() => parseParityArgs(['--pair', 'threejs-webgl,threejs-webgl'])).toThrow(
			'--pair needs two different page kinds',
		);
		expect(() =>
			parseParityArgs(['--pair', 'threejs-webgl,threejs-webgpu', '--tier', 'webgpu']),
		).toThrow('use --tier or --pair, not both');
		expect(() => parseParityArgs(['--scene'])).toThrow('name at least one scene');
		expect(() => parseParityArgs(['--fast'])).toThrow('unknown option --fast');
	});
});

describe('passesWithBaseline', () => {
	test('passes under three.js limit, or no worse than three.js renderers differ', () => {
		expect(passesWithBaseline(0.0009, null)).toBe(true);
		expect(passesWithBaseline(0.001, null)).toBe(false);
		expect(passesWithBaseline(0.02, 0.04)).toBe(true);
		expect(passesWithBaseline(0.04, 0.04)).toBe(true);
		expect(passesWithBaseline(0.05, 0.04)).toBe(false);
		expect(differenceText({ share: 0.02 }, 0.04)).toBe(
			"2.000% of pixels differ; three.js's rule allows under 0.1%, and three.js's two renderers differ by 4.000%",
		);
	});
});
