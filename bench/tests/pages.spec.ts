// The benchmark pages of both engines: each page's short benchmark run, and the hold frames of the
// three.js pages, which must show the scene. The image test manifest compares null3D's hold frames
// with their references, and the parity command compares them with three.js's.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { writePng } from '../../packages/cli/src/png.js';
import { isNull3dPage, PARITY_SCENES, type PageKind, pagePath, SCENE_CODE } from '../lib/parity';
import { BACKGROUND, PARITY_CANVAS, S2_NODES_PER_TREE, s2Trees } from '../scenes/spec';
import { openPage, type PageReport, runPage } from './open-page';

const SCENES = PARITY_SCENES;
/** The pages each scene is tested on, with the renderer each one reports. */
const PAGES: { kind: PageKind; renderer: string }[] = [
	{ kind: 'threejs-webgl', renderer: 'webgl' },
	{ kind: 'threejs-webgpu', renderer: 'webgpu' },
	{ kind: 'null3d-webgpu', renderer: 'null3d' },
	{ kind: 'null3d-webgl2', renderer: 'null3d' },
	{ kind: 'null3d-compat', renderer: 'null3d' },
	{ kind: 'null3d-webgpu-low', renderer: 'null3d' },
	{ kind: 'null3d-webgl2-low', renderer: 'null3d' },
];

/** Where the three.js hold frames are saved, for people to review. */
const IMAGE_DIR = join(import.meta.dirname, '../../test-results/bench');
/** A channel this close to the background's still counts as background: sRGB encoding rounds. */
const BACKGROUND_TOLERANCE = 2;
/**
 * An image counts as blank unless more than this share of its pixels differs from the background.
 * S2's small trees cover less than 1% of its hold frame, so its bar is lower.
 */
const MIN_DRAWN_SHARE: Record<(typeof SCENES)[number], number> = {
	s1: 0.01,
	's1-static': 0.01,
	s2: 0.005,
};
/** The instance count of the short benchmark runs. */
const SHORT_RUN_COUNT = 1000;
/** S2 draws whole trees, so it rounds the short runs' count up to them. */
const S2_SHORT_RUN_COUNT = s2Trees(SHORT_RUN_COUNT) * S2_NODES_PER_TREE;

interface Report extends PageReport {
	scene: string;
	renderer: string;
	n: number;
}

interface HoldReport extends Report {
	width: number;
	height: number;
	pixels: string;
}

interface BenchReport extends Report {
	frames: number;
	cpuMs: { median: number; p95: number; p99: number; mean: number };
	intervalMs: { median: number; p95: number; p99: number };
	userAgent: string;
}

/** How many pixels of an RGBA8 image have the background color, within the tolerance. */
function countBackground(pixels: Uint8Array): number {
	const value = Number.parseInt(BACKGROUND.slice(1), 16);
	const rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
	let count = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const near = (channel: number, c: number) =>
			Math.abs((pixels[i + c] ?? 0) - channel) <= BACKGROUND_TOLERANCE;
		if (rgb.every(near)) count++;
	}
	return count;
}

/** The mean of the RGB channels in rows `fromRow` up to, but not including, `toRow`. */
function meanBrightness(pixels: Uint8Array, width: number, fromRow: number, toRow: number): number {
	let sum = 0;
	for (let i = fromRow * width * 4; i < toRow * width * 4; i += 4) {
		sum += (pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0);
	}
	return sum / ((toRow - fromRow) * width * 3);
}

for (const scene of SCENES) {
	for (const { kind, renderer } of PAGES) {
		if (!isNull3dPage(kind))
			test(`${scene} on ${kind} renders a hold frame that is not blank`, async ({ page }) => {
				const result = await runPage<HoldReport>(page, pagePath(scene, kind, 'hold'));
				expect([result.scene, result.renderer]).toEqual([scene, renderer]);
				const { width, height } = PARITY_CANVAS;
				expect([result.width, result.height]).toEqual([width, height]);
				const pixels = Buffer.from(result.pixels, 'base64');
				expect(pixels.length).toBe(width * height * 4);

				writePng(join(IMAGE_DIR, `${scene}-${kind}.png`), { width, height, data: pixels });

				const total = width * height;
				const background = countBackground(pixels);
				// The background must read back as its own color: with wrong color handling, every pixel
				// would differ from it and the blank check below would pass on any image.
				expect(background).toBeGreaterThan(0);
				expect((total - background) / total).toBeGreaterThan(MIN_DRAWN_SHARE[scene]);

				if (scene === 's1-static') {
					// Rows must arrive top first. The sun shines from above, so the lit tops of the boxes
					// below eye level make the lower half of this frame brighter than the upper half.
					// Upside-down rows would reverse that.
					const middle = height / 2;
					expect(meanBrightness(pixels, width, middle, height)).toBeGreaterThan(
						meanBrightness(pixels, width, 0, middle),
					);
				}
			});

		test(`${scene} on ${kind} runs a short benchmark`, async ({ page }) => {
			const result = await runPage<BenchReport>(
				page,
				pagePath(scene, kind, `seconds=2&n=${SHORT_RUN_COUNT}`),
			);
			expect([result.scene, result.renderer]).toEqual([scene, renderer]);
			expect(result.n).toBe(scene === 's2' ? S2_SHORT_RUN_COUNT : SHORT_RUN_COUNT);
			expect(result.frames).toBeGreaterThan(0);
			expect(result.cpuMs.median).toBeGreaterThan(0);
			expect(result.intervalMs.median).toBeGreaterThan(0);
			expect(result.userAgent).toContain('Chrome');
		});
	}
}

for (const scene of SCENES) {
	test(`${scene}'s scene code runs alone and reports its time`, async ({ page }) => {
		const result = await runPage<BenchReport>(
			page,
			pagePath(scene, SCENE_CODE, `seconds=1&n=${SHORT_RUN_COUNT}`),
		);
		expect([result.scene, result.renderer]).toEqual([scene, SCENE_CODE]);
		expect(result.n).toBe(scene === 's2' ? S2_SHORT_RUN_COUNT : SHORT_RUN_COUNT);
		expect(result.frames).toBeGreaterThan(0);
		// S1 moves every instance; the other scenes' code is a camera path and a few turns, which can
		// take less time than the browser's clock resolves.
		if (scene === 's1') expect(result.cpuMs.median).toBeGreaterThan(0);
		else expect(result.cpuMs.median).toBeGreaterThanOrEqual(0);
	});
}

test('a scene-code page refuses a hold frame, because it draws nothing', async ({ page }) => {
	const { result } = await openPage<Report>(page, pagePath('s1', SCENE_CODE, 'hold'));
	expect(result.ok).toBe(false);
	expect(result.error).toContain('draws nothing');
});

// A WebGPU run must never measure WebGL by mistake. Each script below runs before the page's own
// code and takes WebGPU away in one of two ways.
const NO_WEBGPU = {
	'the browser has no WebGPU': {
		script: 'delete Navigator.prototype.gpu;',
		error: 'This browser has no WebGPU',
	},
	'WebGPU cannot start, so three.js would switch to WebGL 2': {
		script: 'GPU.prototype.requestAdapter = async () => null;',
		error: 'three.js could not start WebGPU and switched to WebGL 2',
	},
};

for (const [situation, { script, error }] of Object.entries(NO_WEBGPU)) {
	test(`a WebGPU page reports an error when ${situation}`, async ({ page }) => {
		await page.addInitScript({ content: script });
		const { result } = await openPage<Report>(page, 'threejs/s1.html?renderer=webgpu&hold&n=10');
		expect(result.ok).toBe(false);
		expect(result.error).toContain(error);
	});
}
