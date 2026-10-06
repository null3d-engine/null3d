// The benchmark pages of both engines: each page's short benchmark run, and the hold frames of the
// three.js pages, which must show the scene. The image test manifest compares null3D's hold frames
// with their references, and the parity command compares them with three.js's.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { defaultEnvironment } from '../../packages/cli/src/browser.js';
import { writePng } from '../../packages/cli/src/png.js';
import { BENCH_SCENES, isNull3dPage, type PageKind, pagePath, SCENE_CODE } from '../lib/parity';
import type { TraceSecond } from '../pages/lib/trace';
import { S5_BACKGROUND } from '../scenes/s5';
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
	s5: 0.3,
};
/** Each scene's background color. S4's is its fog's color. */
const BACKGROUNDS: Record<(typeof SCENES)[number], string> = {
	s1: BACKGROUND,
	's1-static': BACKGROUND,
	's1-cells': BACKGROUND,
	s2: BACKGROUND,
	s3: BACKGROUND,
	s4: S4_FOG.color,
	s5: S5_BACKGROUND,
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
/** S5's characters in the short benchmark runs: a crowd that SwiftShader skins in time. */
const S5_SHORT_RUN_COUNT = 20;
/**
 * The scenes whose canvas fills the window at the quality preset's pixel ratio, as a full-screen
 * app on a phone does, and whose pages record a trace of each second.
 */
const PHONE_SCENES: readonly (typeof SCENES)[number][] = ['s4', 's5'];
const isPhoneScene = (scene: (typeof SCENES)[number]) => PHONE_SCENES.includes(scene);
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
 * The warm-up and measured seconds of a page's short benchmark run. null3D counts a frame only when
 * the sketch stepped it and the renderer drew it inside the measured time, and the renderer draws a
 * frame about one frame after the step. So the measured time must hold more than two frames at the
 * page's slowest rate. On SwiftShader, null3D draws S2 with shadows at about 2 frames a second, so
 * one second can count none. It draws S4 at a few frames a second, and S3's 256 lights at about
 * one, with each frame done more than two seconds after it starts. The first frames of S3's three.js
 * twin on WebGPU take seconds, so its run is longer on every GPU.
 */
function shortRunSeconds(scene: (typeof SCENES)[number], kind: PageKind): number {
	if ((scene === 's3' || isPhoneScene(scene)) && SWIFTSHADER) return 8;
	if (scene === 's3' && kind === 'threejs-webgpu') return 5;
	return 2;
}
/** S4's and S5's canvas fills the window. A small window keeps their frames short on SwiftShader. */
const PHONE_VIEWPORT = { width: 480, height: 320 };
/** The object count that a scene's short runs ask for. */
const shortRunAsked = (scene: (typeof SCENES)[number]): number =>
	scene === 's5' ? S5_SHORT_RUN_COUNT : SHORT_RUN_COUNT;
/**
 * The object count that a scene's short runs report: S2 rounds the count up to whole trees, and S4
 * has one town, whose count is fixed.
 */
const shortRunCount = (scene: (typeof SCENES)[number]): number =>
	scene === 's2'
		? s2Trees(SHORT_RUN_COUNT) * S2_NODES_PER_TREE
		: scene === 's4'
			? createS4().count
			: shortRunAsked(scene);

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
	stats: {
		drawCalls: { median: number; p99: number };
		gpuPassMs: { name: string }[] | null;
	};
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
			if (isPhoneScene(scene)) await page.setViewportSize(PHONE_VIEWPORT);
			const result = await runPage<BenchReport>(
				page,
				pagePath(scene, kind, `seconds=${shortRunSeconds(scene, kind)}&n=${shortRunAsked(scene)}`),
			);
			expect([result.scene, result.renderer]).toEqual([scene, renderer]);
			expect(result.n).toBe(shortRunCount(scene));
			expect(result.frames).toBeGreaterThan(0);
			expect(result.cpuMs.median).toBeGreaterThan(0);
			expect(result.intervalMs.median).toBeGreaterThan(0);
			expect(result.userAgent).toContain('Chrome');
			if (isPhoneScene(scene)) {
				// The canvas fills the window below the status line, and each second has its row.
				expect(result.canvas?.width).toBe(PHONE_VIEWPORT.width);
				expect(result.canvas?.height).toBeLessThan(PHONE_VIEWPORT.height);
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
			pagePath('s2', kind, `seconds=${shortRunSeconds('s2', kind)}&n=${SHORT_RUN_COUNT}&shadows=2`),
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

/**
 * The draw calls of S4's frames at Low with the governor off, as the gate's GPU comparison on the
 * iPad runs it. On WebGPU the GPU culls, so the draw calls do not depend on the view: the camera's
 * opaque pass and each shadow cascade draw S4's buckets, and the final pass draws one triangle.
 * S4's cars drive through Low's far cascade, and far cascades follow moving casters on every
 * preset (D-16). On Low the far cascade draws through its cache of still casters: in every frame
 * it draws one triangle that copies the cache, then the buckets for its cars, and one frame in 4
 * also draws the buckets into the cache. A new pass or draw in these frames costs every phone that
 * runs S4, so a change to these figures needs its reason in .dev/implementation-notes.md.
 */
const S4_LOW_DRAW_CALLS = { betweenTurns: 64, inTurns: 71 };
/**
 * The passes of S4's frames at Low: the culling, the cascades, the far cascade's cache in its
 * turns, the scene and the final pass.
 */
const S4_LOW_PASSES = ['compute 1', 'render 1', 'render 2', 'render 3', 'render 4', 'render 5'];
/** Enough measured frames to hold a frame that draws the far cascade's cache, which draws 1 in 4. */
const S4_LOW_FRAMES_WITH_TURNS = 8;

function s4LowPassesTest(): void {
	test('s4 on null3d-webgpu at Low draws its far cascade through its cache and no other pass', async ({
		page,
	}) => {
		await page.setViewportSize(PHONE_VIEWPORT);
		const result = await runPage<BenchReport>(
			page,
			pagePath(
				's4',
				'null3d-webgpu',
				`seconds=${shortRunSeconds('s4', 'null3d-webgpu')}&preset=low&governor=off`,
			),
		);
		expect(result.frames).toBeGreaterThan(0);
		const { drawCalls, gpuPassMs } = result.stats;
		expect(drawCalls.median).toBe(S4_LOW_DRAW_CALLS.betweenTurns);
		if (result.frames >= S4_LOW_FRAMES_WITH_TURNS)
			expect(drawCalls.p99).toBe(S4_LOW_DRAW_CALLS.inTurns);
		else expect(drawCalls.p99).toBeLessThanOrEqual(S4_LOW_DRAW_CALLS.inTurns);
		// Where the device has timestamp queries, the GPU timer names each pass of the timed frames.
		if (gpuPassMs) {
			const passes = gpuPassMs
				.map((part) => part.name)
				.filter((name) => name !== 'copies' && name !== 'between passes');
			expect(S4_LOW_PASSES).toEqual(expect.arrayContaining(passes));
			expect(passes).toEqual(expect.arrayContaining(S4_LOW_PASSES.slice(0, 5)));
		}
	});
}

for (const scene of SCENES) {
	if (isPhoneScene(scene))
		// S4 and S5 keep SwiftShader's processor busy, so two runs of one side by side can measure no
		// whole second. Each one's pages take turns in one worker, while other tests run beside them.
		test.describe(`${scene.toUpperCase()}'s pages take turns`, () => {
			test.describe.configure({ mode: 'default' });
			sceneTests(scene);
			if (scene === 's4') s4LowPassesTest();
		});
	else sceneTests(scene);
}

for (const scene of SCENES) {
	test(`${scene}'s scene code runs alone and reports its time`, async ({ page }) => {
		const result = await runPage<BenchReport>(
			page,
			pagePath(scene, SCENE_CODE, `seconds=1&n=${shortRunAsked(scene)}`),
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
