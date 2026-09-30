import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEMOS } from '../../examples/demos.ts';
import { IMAGE_RUNS, IMAGE_TESTS, manifestRun } from '../image/manifest.ts';
import { ENGINE_MODES, type EngineMode } from './engine-checks.ts';
import {
	borrowedRun,
	type CandidateFacts,
	clearCandidate,
	clearCandidates,
	compareWithReference,
	DEVICE_TOLERANCE,
	environmentNamed,
	type HarnessDirs,
	type ImageRun,
	type ImageTest,
	imageProblems,
	imageRuns,
	manifestProblems,
	type Place,
	readPng,
	referenceOf,
	TOLERANCE,
	writePng,
} from './images.ts';
import type { ItemResult } from './runs.ts';
import { REPO_ROOT } from './server.ts';

/** A few tests of every kind, on made-up pages whose files the checks below say exist. */
const TESTS: readonly ImageTest[] = [
	{
		name: 'boxes',
		sketch: 'sketches/boxes.ts?view=far',
		hold: 1.5,
		size: [4, 2],
		modes: ['pipelined', 'low latency'],
	},
	{
		name: 'boxes-copied',
		sketch: 'sketches/boxes.ts?view=far',
		hold: 1.5,
		size: [4, 2],
		tiers: ['webgl2'],
		switches: ['uploads=copy'],
		reference: 'boxes',
		tolerance: { maxDiffRatio: 0.5 },
	},
	{
		name: 'grid',
		page: 'pages/grid.html',
		size: [4, 2],
		sameOnEveryTier: true,
		devices: ['ipad'],
		expect: { visible: [1, 2] },
	},
];
const RUNS = imageRuns(TESTS);
const run = (id: string) => {
	const found = RUNS.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`no run ${id}`);
	return found;
};

const REAL: Place = { environment: 'chrome-real-gpu' };
const SAFARI: Place = { runner: 'mac-safari', device: 'mac' };
const IPAD: Place = { runner: 'ipad-safari', device: 'ipad' };

/** A 4 x 2 image of one color, with the pixel at `odd` in another. */
function image(rgb: readonly number[], odd?: { at: number; rgb: readonly number[] }) {
	const data = new Uint8Array(4 * 2 * 4);
	for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
	if (odd) data.set([...odd.rgb, 255], odd.at * 4);
	return { width: 4, height: 2, data };
}

/** A page's result with an image and the facts a run checks. */
function resultOf(
	{ width, height, data }: ReturnType<typeof image>,
	extra: Record<string, unknown> = {},
): ItemResult {
	return { ok: true, width, height, pixels: Buffer.from(data).toString('base64'), ...extra };
}

/** The facts and the engine mode that a sketch run's page reports. */
const engineFacts = (
	tier: string,
	mode: EngineMode = ENGINE_MODES[0],
	hold: number | null = 1.5,
) => ({
	tier,
	mode: { build: mode.build, latency: mode.latency, renderThread: mode.renderThread, hold },
});

let dirs: HarnessDirs;
beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'null3d-images-'));
	dirs = { references: join(root, 'references'), candidates: join(root, 'candidates') };
});
afterEach(() => rmSync(join(dirs.references, '..'), { recursive: true, force: true }));

const facts = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as CandidateFacts;

describe('the manifest', () => {
	it('lists valid tests, whose pages and sketches exist', () => {
		expect(manifestProblems(IMAGE_TESTS)).toEqual([]);
	});

	it('runs every existing image test, the benchmark scenes included, on the tiers they had', () => {
		const tiers = (test: string) =>
			[...new Set(IMAGE_RUNS.filter((r) => r.test === test).map((r) => r.tier))].join();
		expect(tiers('clear')).toBe('webgpu,webgl2');
		expect(tiers('replay-instanced')).toBe('webgpu');
		for (const test of ['replay-textures', 'held', 'scene', 's1', 's1-static', 's2'])
			expect(tiers(test)).toBe('webgpu,compat,webgl2');
		expect(IMAGE_RUNS.filter((r) => r.test === 'held').map((r) => r.mode?.name)).toHaveLength(12);
		expect(manifestRun('s1', 'compat', 'low latency').path).toBe(
			'/bench/pages/null3d/s1.html?gpu=compat&latency=low&hold=2',
		);
		expect(new Set(IMAGE_RUNS.map((r) => r.id)).size).toBe(IMAGE_RUNS.length);
	});

	it('draws every demo in examples/, each a sketch of under 150 lines', () => {
		const examples = join(REPO_ROOT, 'examples');
		const sketchOf = (name: string) => join(examples, name, 'sketch.ts');
		const folders = readdirSync(examples).filter((name) => existsSync(sketchOf(name)));
		expect(DEMOS.map((demo) => demo.name).sort()).toEqual(folders.sort());
		const tests = new Set(IMAGE_TESTS.map((test) => ('sketch' in test ? test.sketch : '')));
		expect(DEMOS.filter((demo) => !tests.has(`examples/${demo.name}/sketch.ts`))).toEqual([]);
		const long = DEMOS.filter(
			(demo) => readFileSync(sketchOf(demo.name), 'utf8').trimEnd().split('\n').length >= 150,
		);
		expect(long.map((demo) => demo.name)).toEqual([]);
	});

	it('finds what is wrong with a list of tests', () => {
		const exists = (file: string) => file.startsWith('sketches/') || file.startsWith('pages/');
		expect(manifestProblems(TESTS, exists)).toEqual([]);
		const bad: ImageTest[] = [
			...TESTS,
			{ name: 'boxes', sketch: 'sketches/boxes.ts', hold: 1 },
			{ name: 'Spaced Name', sketch: 'gone/sketch.ts', hold: 601, tiers: [] },
			{ name: 'far', page: 'pages/far.html', size: [0, 2], reference: 'grid', devices: ['iPad'] },
			{ name: 'lent', sketch: 'sketches/boxes.ts', hold: 1, reference: 'boxes-copied' },
			{ name: 'lone', sketch: 'sketches/boxes.ts', hold: 1, size: [4, 2], reference: 'missing' },
		];
		expect(manifestProblems(bad, exists)).toEqual([
			'two tests are named boxes',
			'Spaced Name: use lowercase words joined by dashes',
			'Spaced Name: list each tier once, and at least one',
			'Spaced Name: hold at 0 to 600 seconds, not 601',
			'Spaced Name: gone/sketch.ts does not exist',
			'far: the size must be whole pixels, not 0 x 2',
			"far: the device iPad is not a runner's device",
			"far: its size differs from grid's",
			'lent: boxes-copied borrows its references, so it cannot lend them',
			'lone: the reference missing must name another test',
		]);
	});
});

describe('the runs of a test', () => {
	it('opens a sketch on the image page with its tier, mode, hold time, switches and size', () => {
		expect(RUNS.map((r) => r.id)).toEqual([
			'boxes-webgpu-pipelined',
			'boxes-webgpu-low-latency',
			'boxes-compat-pipelined',
			'boxes-compat-low-latency',
			'boxes-webgl2-pipelined',
			'boxes-webgl2-low-latency',
			'boxes-copied-webgl2-pipelined',
			'grid-webgpu',
			'grid-compat',
			'grid-webgl2',
		]);
		// The sketch's own query stays in its switch, and the slashes stay readable.
		expect(run('boxes-webgl2-low-latency').path).toBe(
			'/tests/pages/image.html?gpu=webgl2&latency=low&hold=1.5&size=4x2&sketch=/sketches/boxes.ts%3Fview%3Dfar',
		);
		expect(run('boxes-copied-webgl2-pipelined').path).toBe(
			'/tests/pages/image.html?gpu=webgl2&hold=1.5&uploads=copy&size=4x2&sketch=/sketches/boxes.ts%3Fview%3Dfar',
		);
		expect(run('grid-compat').path).toBe('/pages/grid.html?gpu=compat');
		expect(run('grid-compat').mode).toBeUndefined();
	});

	it('names the first mode, which every later mode on the tier must match', () => {
		expect(run('boxes-compat-pipelined').sameAs).toBeUndefined();
		expect(run('boxes-compat-low-latency').sameAs).toBe('boxes-compat-pipelined');
	});

	it('fills in the tolerances, and the references that each run compares with', () => {
		expect(run('boxes-webgpu-pipelined')).toMatchObject({
			tolerance: TOLERANCE,
			deviceTolerance: DEVICE_TOLERANCE,
			timeoutSeconds: 30,
			reference: { test: 'boxes', tier: 'webgpu', devices: [] },
		});
		expect(run('boxes-copied-webgl2-pipelined')).toMatchObject({
			tolerance: { threshold: TOLERANCE.threshold, maxDiffRatio: 0.5 },
			reference: { test: 'boxes', tier: 'webgl2' },
		});
		expect(run('grid-webgl2').reference).toEqual({
			test: 'grid',
			tier: 'webgpu',
			devices: ['ipad'],
		});
	});

	it('refuses a test that borrows the references of a test the list lacks', () => {
		expect(() => imageRuns([{ name: 'a', sketch: 's.ts', hold: 0, reference: 'b' }])).toThrow(
			'a compares with the references of b, which the manifest lacks',
		);
	});
});

describe('the reference of a run', () => {
	it("is the environment's own in Playwright's runs, and becomes the reference", () => {
		expect(referenceOf(run('boxes-compat-pipelined'), REAL)).toEqual({
			file: 'chrome-real-gpu/compat/boxes.png',
			tolerance: TOLERANCE,
		});
	});

	it("is the real GPU's for another browser, at the device tolerance, and cannot become it", () => {
		const reference = referenceOf(run('boxes-webgl2-pipelined'), SAFARI);
		expect(reference.file).toBe('chrome-real-gpu/webgl2/boxes.png');
		expect(reference.tolerance).toEqual(DEVICE_TOLERANCE);
		expect(reference.fixed).toContain("add 'mac' to the test's devices");
	});

	it("is a device's own where the test records the device", () => {
		expect(referenceOf(run('grid-webgpu'), IPAD)).toEqual({
			file: 'ipad/webgpu/grid.png',
			tolerance: TOLERANCE,
		});
	});

	it('belongs to the test and the tier that make it', () => {
		expect(referenceOf(run('boxes-copied-webgl2-pipelined'), REAL).fixed).toBe(
			'boxes-copied must draw the image of boxes, which alone makes this reference',
		);
		const grid = referenceOf(run('grid-webgl2'), IPAD);
		expect(grid.file).toBe('ipad/webgpu/grid.png');
		expect(grid.fixed).toBe(
			'every tier must draw the image of webgpu, which alone makes this reference',
		);
	});
});

describe('comparing an image with its reference', () => {
	const boxes = () => run('boxes-webgpu-pipelined');
	const base = (place: string, tier: string, test: string) =>
		join(dirs.candidates, place, tier, test);

	it('saves an image without a reference as a new candidate', () => {
		const problems = compareWithReference(boxes(), REAL, image([10, 20, 30]), dirs);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('there is no reference chrome-real-gpu/webgpu/boxes.png yet');
		const saved = base('chrome-real-gpu', 'webgpu', 'boxes');
		expect(facts(`${saved}.json`)).toEqual({
			test: 'boxes',
			tier: 'webgpu',
			mode: 'pipelined',
			drawnIn: 'chrome-real-gpu',
			status: 'new',
			reference: 'chrome-real-gpu/webgpu/boxes.png',
			tolerance: TOLERANCE,
		});
		expect(readPng(`${saved}.png`)).toEqual(image([10, 20, 30]));
	});

	it('passes an image within the tolerance, and saves nothing', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		expect(compareWithReference(boxes(), REAL, image([10, 20, 30]), dirs)).toEqual([]);
		expect(existsSync(dirs.candidates)).toBe(false);
	});

	it('fails a wrong reference with the new image, a diff and a copy of the reference', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		// One pixel of eight is another color: 12.5% of the image, far over the 0.1% allowed.
		const drawn = image([10, 20, 30], { at: 5, rgb: [250, 20, 30] });
		const [problem] = compareWithReference(boxes(), REAL, drawn, dirs);
		expect(problem).toContain(
			'12.500% of pixels differ from the reference chrome-real-gpu/webgpu/boxes.png, and at most 0.100% may',
		);
		const saved = base('chrome-real-gpu', 'webgpu', 'boxes');
		expect(readdirSync(join(saved, '..')).sort()).toEqual([
			'boxes-diff.png',
			'boxes-reference.png',
			'boxes.json',
			'boxes.png',
		]);
		expect(facts(`${saved}.json`)).toMatchObject({ status: 'changed', share: 0.125 });
		// The diff marks the differing pixel in red.
		const diff = readPng(`${saved}-diff.png`).data;
		expect([...diff.subarray(5 * 4, 5 * 4 + 3)]).toEqual([255, 0, 0]);
		expect(readPng(`${saved}-reference.png`)).toEqual(image([10, 20, 30]));
	});

	it("fails an image of another size than the reference's", () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), {
			width: 2,
			height: 2,
			data: new Uint8Array(16),
		});
		expect(compareWithReference(boxes(), REAL, image([1, 2, 3]), dirs)[0]).toContain(
			'the image is 4 x 2, and the reference chrome-real-gpu/webgpu/boxes.png is 2 x 2',
		);
	});

	it('keeps the candidate of the first mode that differs, until the test runs again', () => {
		compareWithReference(boxes(), REAL, image([10, 20, 30]), dirs);
		compareWithReference(run('boxes-webgpu-low-latency'), REAL, image([90, 20, 30]), dirs);
		const saved = base('chrome-real-gpu', 'webgpu', 'boxes');
		expect(facts(`${saved}.json`).mode).toBe('pipelined');
		clearCandidate(boxes(), REAL, dirs);
		expect(existsSync(`${saved}.json`)).toBe(false);
		expect(existsSync(`${saved}.png`)).toBe(false);
	});

	it("saves another browser's image under its runner, with why it cannot become the reference", () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgl2/boxes.png'), image([10, 20, 30]));
		const drawn = image([10, 20, 30], { at: 0, rgb: [250, 20, 30] });
		expect(compareWithReference(run('boxes-webgl2-pipelined'), SAFARI, drawn, dirs)).toHaveLength(
			1,
		);
		const saved = facts(`${base('mac-safari', 'webgl2', 'boxes')}.json`);
		expect(saved).toMatchObject({ drawnIn: 'mac-safari', tolerance: DEVICE_TOLERANCE });
		expect(saved.fixed).toContain("add 'mac' to the test's devices");
		clearCandidates(SAFARI, dirs);
		expect(existsSync(join(dirs.candidates, 'mac-safari'))).toBe(false);
	});
});

describe("judging a run's result", () => {
	const referenceOfBoxes = () =>
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));

	it('passes the image of the tier, mode and hold time that the run asked for', () => {
		referenceOfBoxes();
		const result = resultOf(image([10, 20, 30]), engineFacts('webgpu'));
		expect(imageProblems(run('boxes-webgpu-pipelined'), result, REAL, undefined, dirs)).toEqual([]);
	});

	it('fails another tier, thread mode or hold time, GPU errors, and wrong values', () => {
		referenceOfBoxes();
		const lowLatency = ENGINE_MODES[1];
		const result = resultOf(image([10, 20, 30]), {
			...engineFacts('webgpu-compat', lowLatency, 2),
			errors: ['a view is invalid'],
		});
		expect(imageProblems(run('boxes-webgpu-pipelined'), result, REAL, undefined, dirs)).toEqual([
			'GPU error: a view is invalid',
			'drew on webgpu-compat, not webgpu',
			'ran low latency',
			'drew on sketch-worker, expected render-worker',
			'held at 2 seconds, not 1.5',
		]);
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/grid.png'), image([10, 20, 30]));
		const grid = resultOf(image([10, 20, 30]), { visible: [2, 1] });
		expect(imageProblems(run('grid-webgpu'), grid, REAL, undefined, dirs)).toEqual([
			'visible is [2,1], not [1,2]',
		]);
		const noMode = resultOf(image([10, 20, 30]), { tier: 'webgpu' });
		expect(imageProblems(run('boxes-webgpu-pipelined'), noMode, REAL, undefined, dirs)).toEqual([
			'the page reported no thread mode',
			'the engine did not hold at 1.5 seconds',
		]);
	});

	it("fails a WebGPU device without core features, and one with them in Chrome's compatibility mode", () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/grid.png'), image([1, 2, 3]));
		const drawn = (core: boolean, tier: string) =>
			resultOf(image([1, 2, 3]), { visible: [1, 2], tier, core });
		expect(
			imageProblems(run('grid-webgpu'), drawn(false, 'webgpu'), REAL, undefined, dirs),
		).toEqual(['the device lacks core features']);
		const compat = drawn(true, 'webgpu-compat');
		expect(imageProblems(run('grid-compat'), compat, REAL, undefined, dirs)).toEqual([
			'the device has core features, so it drew outside compatibility mode',
		]);
		// Safari and Firefox give a core device for every request.
		expect(imageProblems(run('grid-compat'), compat, SAFARI, undefined, dirs)).toEqual([]);
	});

	it('fails a mode whose pixels differ at all from the first mode on the tier', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		const first = resultOf(image([10, 20, 30]), engineFacts('webgpu'));
		const later = resultOf(
			image([10, 20, 30], { at: 3, rgb: [10, 20, 31] }),
			engineFacts('webgpu', ENGINE_MODES[1]),
		);
		expect(imageProblems(run('boxes-webgpu-low-latency'), later, REAL, first, dirs)).toEqual([
			'1 pixels differ from the image of the first thread mode, which every mode must draw',
		]);
	});

	it('fails an image of the wrong size or byte count', () => {
		const small = { ...resultOf(image([1, 2, 3])), width: 2 };
		expect(imageProblems(run('grid-webgpu'), small, REAL, undefined, dirs)).toEqual([
			'visible is undefined, not [1,2]',
			'the image is 2 x 2 pixels, not 4 x 2',
		]);
		const short = { ...resultOf(image([1, 2, 3]), { visible: [1, 2] }), pixels: 'AAAA' };
		expect(imageProblems(run('grid-webgpu'), short, REAL, undefined, dirs)).toEqual([
			'the image holds 3 bytes, not the 32 of 4 x 2 RGBA8 pixels',
		]);
	});

	it('refuses a software GPU in a real-GPU run, and takes one on SwiftShader', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/grid.png'), image([1, 2, 3]));
		writePng(join(dirs.references, 'chromium-swiftshader/webgpu/grid.png'), image([1, 2, 3]));
		const adapter = 'google swiftshader SwiftShader Device (Subzero)';
		const result = resultOf(image([1, 2, 3]), { visible: [1, 2], adapter });
		expect(imageProblems(run('grid-webgpu'), result, REAL, undefined, dirs)).toEqual([
			`drew on a software GPU: ${adapter}`,
		]);
		const swiftshader: Place = { environment: 'chromium-swiftshader' };
		expect(imageProblems(run('grid-webgpu'), result, swiftshader, undefined, dirs)).toEqual([]);
	});

	it("compares a behavior test's live image with a manifest test's references, under its own name", () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		const borrowed: ImageRun = borrowedRun(run('boxes-webgpu-low-latency'), 'retain');
		expect(borrowed.hold).toBeUndefined();
		expect(borrowed.sameAs).toBeUndefined();
		const live = resultOf(image([90, 20, 30]), engineFacts('webgpu', ENGINE_MODES[1], null));
		expect(imageProblems(borrowed, live, REAL, undefined, dirs)[0]).toContain(
			'100.000% of pixels differ from the reference chrome-real-gpu/webgpu/boxes.png',
		);
		const saved = facts(join(dirs.candidates, 'chrome-real-gpu/webgpu/retain.json'));
		expect(saved.fixed).toBe(
			'retain must draw the image of boxes, which alone makes this reference',
		);
	});
});

describe('environmentNamed', () => {
	it('takes the Playwright projects that name an environment, and refuses others', () => {
		expect(environmentNamed('chromium-swiftshader')).toBe('chromium-swiftshader');
		expect(() => environmentNamed('production build')).toThrow(
			'image tests run in the Playwright projects chromium-swiftshader and chrome-real-gpu, not production build',
		);
	});
});
