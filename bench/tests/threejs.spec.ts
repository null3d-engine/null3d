import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { encode } from 'fast-png';
import { BACKGROUND, PARITY_CANVAS, S2_NODE_COUNT } from '../scenes/spec';

const SCENES = ['s1', 's1-static', 's2'] as const;
const RENDERERS = ['webgl', 'webgpu'] as const;

/** Where the hold frames are saved, for people to review. */
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

interface Report {
	ok: boolean;
	error?: string;
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

/** Runs in the page: the result the page published, once it exists. */
const readResult = () => (globalThis as { __sokko3dResult?: unknown }).__sokko3dResult;

/** Opens a page and returns the result that it publishes, with every error that it logs. */
async function openPage<T extends Report>(
	page: Page,
	path: string,
): Promise<{ result: T; errors: string[] }> {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.goto(path);
	const handle = await page.waitForFunction(readResult, undefined, { timeout: 90_000 });
	return { result: (await handle.jsonValue()) as T, errors };
}

/** Opens a page and returns its result. It fails on a page error and on any error in the console. */
async function runPage<T extends Report>(page: Page, path: string): Promise<T> {
	const { result, errors } = await openPage<T>(page, path);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	expect(errors).toEqual([]);
	return result;
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
	for (const renderer of RENDERERS) {
		test(`${scene} on ${renderer} renders a hold frame that is not blank`, async ({ page }) => {
			const result = await runPage<HoldReport>(
				page,
				`/threejs/${scene}.html?renderer=${renderer}&hold`,
			);
			expect([result.scene, result.renderer]).toEqual([scene, renderer]);
			const { width, height } = PARITY_CANVAS;
			expect([result.width, result.height]).toEqual([width, height]);
			const pixels = Buffer.from(result.pixels, 'base64');
			expect(pixels.length).toBe(width * height * 4);

			mkdirSync(IMAGE_DIR, { recursive: true });
			writeFileSync(
				join(IMAGE_DIR, `${scene}-${renderer}.png`),
				encode({ width, height, data: pixels, channels: 4, depth: 8 }),
			);

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

		test(`${scene} on ${renderer} runs a short benchmark`, async ({ page }) => {
			const result = await runPage<BenchReport>(
				page,
				`/threejs/${scene}.html?renderer=${renderer}&seconds=2&n=${SHORT_RUN_COUNT}`,
			);
			expect([result.scene, result.renderer]).toEqual([scene, renderer]);
			expect(result.n).toBe(scene === 's2' ? S2_NODE_COUNT : SHORT_RUN_COUNT);
			expect(result.frames).toBeGreaterThan(0);
			expect(result.cpuMs.median).toBeGreaterThan(0);
			expect(result.intervalMs.median).toBeGreaterThan(0);
			expect(result.userAgent).toContain('Chrome');
		});
	}
}

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
		const { result } = await openPage<Report>(page, '/threejs/s1.html?renderer=webgpu&hold&n=10');
		expect(result.ok).toBe(false);
		expect(result.error).toContain(error);
	});
}
