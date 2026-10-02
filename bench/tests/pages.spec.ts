// The benchmark pages of both engines: each page's short benchmark run, and the hold frames of the
// three.js pages, which must show the scene. The image test manifest compares null3D's hold frames
// with their references, and the parity command compares them with three.js's.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { defaultEnvironment } from '../../packages/cli/src/browser.js';
import { writePng } from '../../packages/cli/src/png.js';
import { BENCH_SCENES, isNull3dPage, type PageKind, pagePath, SCENE_CODE } from '../lib/parity';
import type { TraceSecond } from '../pages/lib/trace';
import {
	BACKGROUND,
	createS4,
	PARITY_CANVAS,
	S2_NODES_PER_TREE,
	S4_FOG,
	s2Trees,
} from '../scenes/spec';
import { openPage, type PageReport, runPage } from './open-page';

// Each test opens a page of its own, so the tests run on any worker and in any shard.
test.describe.configure({ mode: 'parallel' });

const SCENES = BENCH_SCENES;
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
 * S2's small trees cover less than 1% of its hold frame, so its bar is lower. S3's floor covers
 * most of its frame, so its bar is higher.
 */
const MIN_DRAWN_SHARE: Record<(typeof SCENES)[number], number> = {
	s1: 0.01,
	's1-static': 0.01,
	's1-cells': 0.002,
	s2: 0.005,
	s3: 0.1,
	s4: 0.5,
};
/** Each scene's background color. S4's is its fog's color. */
const BACKGROUNDS: Record<(typeof SCENES)[number], string> = {
	s1: BACKGROUND,
	's1-static': BACKGROUND,
	's1-cells': BACKGROUND,
	s2: BACKGROUND,
	s3: BACKGROUND,
	s4: S4_FOG.color,
};
/**
 * Pages whose renderer cannot draw their scene on the GPU that the tests draw with. WebGLRenderer's
 * shader for S3's 256 point lights needs more than the 1,024 uniform vectors that the Mac's GPU
 * gives a fragment shader, so the shader fails to build there, and the page must say so.
 * SwiftShader gives 4,096, and the shader builds, but only after minutes, so the tests leave the
 * page out on SwiftShader.
 */
const CANNOT_DRAW: readonly string[] = ['s3 on threejs-webgl'];
const SWIFTSHADER = defaultEnvironment() === 'chromium-swiftshader';
/** The instance count of the short benchmark runs. */
const SHORT_RUN_COUNT = 1000;
/**
 * Pages that SwiftShader draws too slowly for the tests: S4's three.js twins take minutes over their
 * first frames, with shadows in cascades over 5,000 objects. The tests run them on real GPUs only.
 */
const TOO_SLOW_FOR_SWIFTSHADER: readonly string[] = ['s4 on threejs-webgl', 's4 on threejs-webgpu'];
/** Leaves a page's test out on SwiftShader when SwiftShader draws the page too slowly. */
const skipWhereTooSlow = (page: string) =>
	test.skip(
		SWIFTSHADER && TOO_SLOW_FOR_SWIFTSHADER.includes(page),
		'SwiftShader takes minutes to draw its first frames',
	);
/**
 * The warm-up and measured seconds of a page's short benchmark run. On SwiftShader, null3D draws S4
 * at a few frames a second, and S3's 256 lights at about one, with each frame done more than two
 * seconds after it starts. The first frames of S3's three.js twin on WebGPU take seconds, so its run
 * is longer on every GPU. These runs need longer to measure frames.
 */
function shortRunSeconds(scene: (typeof SCENES)[number], kind: PageKind): number {
	if ((scene === 's3' || scene === 's4') && SWIFTSHADER) return 8;
	if (scene === 's3' && kind === 'threejs-webgpu') return 5;
	return 2;
}
/** S4's canvas fills the window. A small window keeps its frames short on SwiftShader. */
const S4_VIEWPORT = { width: 480, height: 320 };
/**
 * The object count that a scene's short runs report: S2 rounds the count up to whole trees, and S4
 * has one town, whose count is fixed.
 */
const shortRunCount = (scene: (typeof SCENES)[number]): number =>
	scene === 's2'
		? s2Trees(SHORT_RUN_COUNT) * S2_NODES_PER_TREE
		: scene === 's4'
			? createS4().count
			: SHORT_RUN_COUNT;

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
	/** S4: the canvas that filled the window, and the trace of each second. */
	canvas?: { width: number; height: number; pixelRatio: number };
	trace?: TraceSecond[];
	frames: number;
	cpuMs: { median: number; p95: number; p99: number; mean: number };
	intervalMs: { median: number; p95: number; p99: number };
	userAgent: string;
}

/** How many pixels of an RGBA8 image have the background color, within the tolerance. */
function countBackground(pixels: Uint8Array, background: string): number {
	const value = Number.parseInt(background.slice(1), 16);
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

/** Defines the tests of one scene on each page. */
function sceneTests(scene: (typeof SCENES)[number]): void {
	for (const { kind, renderer } of PAGES) {
		if (CANNOT_DRAW.includes(`${scene} on ${kind}`)) {
			test(`${scene} on ${kind} reports that its shader is past the GPU's limits`, async ({
				page,
			}) => {
				test.skip(SWIFTSHADER, 'SwiftShader builds the shader, but takes minutes');
				for (const switches of ['hold', `seconds=1&n=${SHORT_RUN_COUNT}`]) {
					const { result } = await openPage<Report>(page, pagePath(scene, kind, switches));
					expect(result.ok).toBe(false);
					expect(result.error).toContain('could not build a shader of this scene on this GPU');
				}
			});
			continue;
		}
		if (!isNull3dPage(kind))
			test(`${scene} on ${kind} renders a hold frame that is not blank`, async ({ page }) => {
				skipWhereTooSlow(`${scene} on ${kind}`);
				const result = await runPage<HoldReport>(page, pagePath(scene, kind, 'hold'));
				expect([result.scene, result.renderer]).toEqual([scene, renderer]);
				const { width, height } = PARITY_CANVAS;
				expect([result.width, result.height]).toEqual([width, height]);
				const pixels = Buffer.from(result.pixels, 'base64');
				expect(pixels.length).toBe(width * height * 4);

				writePng(join(IMAGE_DIR, `${scene}-${kind}.png`), { width, height, data: pixels });

				const total = width * height;
				const background = countBackground(pixels, BACKGROUNDS[scene]);
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
			skipWhereTooSlow(`${scene} on ${kind}`);
			if (scene === 's4') await page.setViewportSize(S4_VIEWPORT);
			const result = await runPage<BenchReport>(
				page,
				pagePath(scene, kind, `seconds=${shortRunSeconds(scene, kind)}&n=${SHORT_RUN_COUNT}`),
			);
			expect([result.scene, result.renderer]).toEqual([scene, renderer]);
			expect(result.n).toBe(shortRunCount(scene));
			expect(result.frames).toBeGreaterThan(0);
			expect(result.cpuMs.median).toBeGreaterThan(0);
			expect(result.intervalMs.median).toBeGreaterThan(0);
			expect(result.userAgent).toContain('Chrome');
			if (scene === 's4') {
				// The canvas fills the window below the status line, and each second has its row.
				expect(result.canvas?.width).toBe(S4_VIEWPORT.width);
				expect(result.canvas?.height).toBeLessThan(S4_VIEWPORT.height);
				expect(result.trace?.length).toBeGreaterThan(0);
				for (const second of result.trace ?? []) {
					expect(second.renderScale).toBeGreaterThan(0);
					expect(second.renderScale).toBeLessThanOrEqual(1);
					if (isNull3dPage(kind)) expect(second.completedFps).not.toBeNull();
					else expect(second.completedFps).toBeNull();
				}
			} else expect(result.trace).toBeUndefined();
		});
	}
}

// S2 with the sun's shadows, as `bun run bench:run --switches shadows=2` runs it: each engine's page
// runs, and its hold frame is darker than without shadows, where nodes shade the nodes below them.
for (const kind of [
	'threejs-webgl',
	'threejs-webgpu',
	'null3d-webgpu',
	'null3d-compat',
	'null3d-webgl2',
] as const) {
	test(`s2 with shadows on ${kind} runs a short benchmark and shades its hold frame`, async ({
		page,
	}) => {
		const result = await runPage<BenchReport>(
			page,
			pagePath('s2', kind, `seconds=1&n=${SHORT_RUN_COUNT}&shadows=2`),
		);
		expect(result.frames).toBeGreaterThan(0);
		const { width, height } = PARITY_CANVAS;
		const brightness = async (switches: string) => {
			const hold = await runPage<HoldReport>(page, pagePath('s2', kind, switches));
			return meanBrightness(Buffer.from(hold.pixels, 'base64'), width, 0, height);
		};
		expect(await brightness('hold&shadows=2')).toBeLessThan(await brightness('hold'));
	});
}

for (const scene of SCENES) {
	if (scene === 's4')
		// S4 keeps SwiftShader's processor busy, so two of its runs side by side can measure no whole
		// second. Its pages take turns in one worker, while the other scenes' tests run beside them.
		test.describe("S4's pages take turns", () => {
			test.describe.configure({ mode: 'default' });
			sceneTests(scene);
		});
	else sceneTests(scene);
}

for (const scene of SCENES) {
	test(`${scene}'s scene code runs alone and reports its time`, async ({ page }) => {
		const result = await runPage<BenchReport>(
			page,
			pagePath(scene, SCENE_CODE, `seconds=1&n=${SHORT_RUN_COUNT}`),
		);
		expect([result.scene, result.renderer]).toEqual([scene, SCENE_CODE]);
		expect(result.n).toBe(shortRunCount(scene));
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
