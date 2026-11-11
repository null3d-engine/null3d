import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { COMPARISONS } from '../../examples/compare/comparisons.ts';
import { DEMOS, sketchPath } from '../../examples/demos.ts';
import { IMAGE_RUNS, IMAGE_TESTS, manifestRun } from '../image/manifest.ts';
import { ENGINE_MODES, type EngineMode } from './engine-checks.ts';
import {
	borrowedRun,
	type CandidateFacts,
	ciRunOf,
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
	type OtherDrawing,
	otherDrawingProblems,
	type Place,
	pageFactsOf,
	readPng,
	referenceFileProblems,
	referenceOf,
	runIn,
	sharedReferenceProblems,
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
		swiftShaderTolerance: { maxDiffRatio: 0.75 },
	},

	{
		name: 'grid',
		page: 'pages/grid.html',
		size: [4, 2],
		switches: ['preset=low'],
		sameOnEveryTier: true,
		devices: ['ipad'],
		expect: { visible: [1, 2] },
		swiftShaderSwitches: ['n=2', 'far=on'],
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
	mode: {
		build: mode.build,
		latency: mode.latency,
		sketchThread: mode.sketchThread,
		renderThread: mode.renderThread,
		hold,
	},
});

let dirs: HarnessDirs;
beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'null3d-images-'));
	dirs = {
		references: join(root, 'references'),
		candidates: join(root, 'candidates'),
		drawn: join(root, 'drawn'),
	};
});
afterEach(() => rmSync(join(dirs.references, '..'), { recursive: true, force: true }));

const facts = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as CandidateFacts;

/** A demo's source: its sketch, or every module in its folder for a demo of several files. */
const demoSources = (demo: (typeof DEMOS)[number]) => {
	const sketch = join(REPO_ROOT, 'examples', sketchPath(demo));
	if (!demo.code?.endsWith('/')) return readFileSync(sketch, 'utf8');
	const folder = dirname(sketch);
	return readdirSync(folder)
		.filter((file) => file.endsWith('.ts'))
		.map((file) => readFileSync(join(folder, file), 'utf8'))
		.join('\n');
};

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
		expect(IMAGE_RUNS.filter((r) => r.test === 'held').map((r) => r.mode?.name)).toHaveLength(
			3 * ENGINE_MODES.length,
		);
		expect(manifestRun('s1', 'compat', 'low latency').path).toBe(
			'/bench/pages/null3d/s1.html?gpu=compat&latency=low&hold=2&preset=high',
		);
		expect(new Set(IMAGE_RUNS.map((r) => r.id)).size).toBe(IMAGE_RUNS.length);
	});

	it('draws every demo in examples/, each feature demo a sketch of under 150 lines', () => {
		const examples = join(REPO_ROOT, 'examples');
		// Feature demos sit one folder down, and showcase scenes two, under examples/showcase/.
		const sketches = (folder: string): string[] =>
			readdirSync(join(examples, folder), { withFileTypes: true })
				.filter(
					(entry) => entry.isDirectory() && entry.name !== 'lib' && entry.name !== 'node_modules',
				)
				.flatMap((entry) => {
					const path = folder ? `${folder}/${entry.name}` : entry.name;
					if (existsSync(join(examples, path, 'sketch.ts'))) return [`${path}/sketch.ts`];
					return path === 'showcase' ? sketches(path) : [];
				});
		expect(DEMOS.map(sketchPath).sort()).toEqual(sketches('').sort());
		const tests = new Set(IMAGE_TESTS.map((test) => ('sketch' in test ? test.sketch : '')));
		expect(DEMOS.filter((demo) => !tests.has(`examples/${sketchPath(demo)}`))).toEqual([]);
		const long = DEMOS.filter(
			(demo) =>
				demo.group !== 'Showcase' &&
				readFileSync(join(examples, sketchPath(demo)), 'utf8')
					.trimEnd()
					.split('\n').length >= 150,
		);
		expect(long.map((demo) => demo.name)).toEqual([]);
	});

	it('loads files only in the demos that say why', () => {
		// A demo of several files loads a file when any of its modules does.
		const loads = (demo: (typeof DEMOS)[number]) =>
			/\bsampleUrl\(|\bassets\.(?:load\w*|preload)\(/.test(demoSources(demo));
		expect(DEMOS.filter((demo) => loads(demo) !== (demo.assets !== undefined))).toEqual([]);
	});

	it('sets an exposure in each demo that uses timeOfDay', () => {
		// A dusk or night scene at the default exposure shows several times too dark. A demo takes
		// the time of day's exposure or sets its own, directly or through the stage's exposure scale.
		// Creek is exempt: the owner approved its look, which is tuned at the default exposure, and a
		// new exposure would change it.
		const exempt = new Set(['creek']);
		const skipped = DEMOS.filter((demo) => {
			const code = demoSources(demo);
			return !exempt.has(demo.name) && /\btimeOfDay\(/.test(code) && !/\bexposure\w*/.test(code);
		});
		expect(skipped.map((demo) => demo.name)).toEqual([]);
	});

	it('loads files only in the comparisons that say why, in both engines alike', () => {
		const loads = (name: string, half: string) =>
			/\bsampleUrl\(|\bassets\.(?:load\w*|preload)\(/.test(
				readFileSync(join(REPO_ROOT, 'examples', 'compare', name, half), 'utf8'),
			);
		for (const comparison of COMPARISONS) {
			const scene = comparison.sameSceneAs ?? comparison.name;
			const null3d = loads(scene, 'sketch.ts');
			expect([comparison.name, null3d]).toEqual([comparison.name, comparison.assets !== undefined]);
			expect([comparison.name, loads(scene, 'three.ts')]).toEqual([comparison.name, null3d]);
		}
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
			{ name: 'twin', sketch: 'sketches/boxes.ts?far', hold: 1, samePicture: 'grid' },
			{ name: 'self', sketch: 'sketches/grid.ts', hold: 1, samePicture: 'self' },
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
			'twin: it shares a picture with grid, which draws another scene',
			'self: the samePicture self must name another test',
		]);
	});
});

describe('the runs of a test', () => {
	it('opens a sketch on the image page with its tier, mode, hold time, preset, switches and size', () => {
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
			'/tests/pages/image.html?gpu=webgl2&latency=low&hold=1.5&preset=high&size=4x2&sketch=/sketches/boxes.ts%3Fview%3Dfar',
		);
		expect(run('boxes-copied-webgl2-pipelined').path).toBe(
			'/tests/pages/image.html?gpu=webgl2&hold=1.5&preset=high&uploads=copy&size=4x2&sketch=/sketches/boxes.ts%3Fview%3Dfar',
		);
		// A test that names its own preset draws with it alone.
		expect(run('grid-compat').path).toBe('/pages/grid.html?gpu=compat&preset=low');
		expect(run('grid-compat').mode).toBeUndefined();
	});

	it("adds a test's SwiftShader switches, and the flat sky's step count, only where SwiftShader draws", () => {
		expect(runIn(run('grid-compat'), 'chromium-swiftshader').path).toBe(
			'/pages/grid.html?gpu=compat&preset=low&n=2&far=on&cloudSteps=0',
		);
		expect(runIn(run('grid-compat'), 'chrome-real-gpu').path).toBe(
			'/pages/grid.html?gpu=compat&preset=low',
		);
		// A test with no SwiftShader switches of its own draws the flat sky there.
		expect(runIn(run('boxes-webgpu-pipelined'), 'chromium-swiftshader').path).toContain(
			'&cloudSteps=0',
		);
	});

	it('gives a switch that the page has its SwiftShader value, in place, and the flat sky last', () => {
		const [low] = imageRuns([
			{
				name: 'scene',
				sketch: 'sketches/s.ts?x=1',
				hold: 1,
				swiftShaderSwitches: ['preset=low', 'far'],
			},
		]);
		const path = runIn(low as ImageRun, 'chromium-swiftshader').path;
		expect(path).toContain('&preset=low&');
		expect(path).not.toContain('preset=high');
		expect(path.endsWith('&far&cloudSteps=0')).toBe(true);
		expect(path).toContain('sketch=/sketches/s.ts%3Fx%3D1');
	});

	it('names the first mode, which every later mode on the tier must match', () => {
		expect(run('boxes-compat-pipelined').sameAs).toBeUndefined();
		expect(run('boxes-compat-low-latency').sameAs).toBe('boxes-compat-pipelined');
	});

	it('fills in the tolerances, and the references that each run compares with', () => {
		expect(run('boxes-webgpu-pipelined')).toMatchObject({
			tolerance: TOLERANCE,
			deviceTolerance: DEVICE_TOLERANCE,
			timeoutSeconds: 60,
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
			others: [],
			tolerance: TOLERANCE,
		});
	});

	it("takes SwiftShader's own tolerance on SwiftShader alone", () => {
		const swiftShader: Place = { environment: 'chromium-swiftshader' };
		const copied = run('boxes-copied-webgl2-pipelined');
		const threshold = TOLERANCE.threshold;
		expect(referenceOf(copied, REAL).tolerance).toEqual({ threshold, maxDiffRatio: 0.5 });
		expect(referenceOf(copied, swiftShader).tolerance).toEqual({ threshold, maxDiffRatio: 0.75 });
		expect(referenceOf(run('boxes-compat-pipelined'), swiftShader).tolerance).toEqual(TOLERANCE);
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
			others: [],
			tolerance: TOLERANCE,
		});
	});

	it('is the references of another device with the same GPU, for a device that shares them', () => {
		const [shared] = imageRuns([
			{ ...(TESTS[0] as ImageTest), tiers: ['webgl2'], devices: ['sm-s926b', 'sm-s921b'] },
		]);
		expect(
			referenceOf(shared as ImageRun, { runner: 'sm-s921b-chrome', device: 'sm-s921b' }),
		).toEqual({
			file: 'sm-s926b/webgl2/boxes.png',
			others: [],
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

describe('the files in the folder of references', () => {
	/** Every reference that the made-up tests need: both environments' sets, and the iPad's own. */
	const NEEDED = [
		...['chromium-swiftshader', 'chrome-real-gpu'].flatMap((set) => [
			...['webgpu', 'webgl2', 'compat'].map((tier) => `${set}/${tier}/boxes.png`),
			`${set}/webgpu/grid.png`,
		]),
		'ipad/webgpu/grid.png',
	];
	const without = (file: string) => NEEDED.filter((other) => other !== file);

	it('pass when each reference that some place compares with exists, and nothing else', () => {
		expect(referenceFileProblems(RUNS, NEEDED)).toEqual([]);
	});

	it('name a missing real-GPU reference, and the run on the Mac that makes it', () => {
		expect(referenceFileProblems(RUNS, without('chrome-real-gpu/compat/boxes.png'))).toEqual([
			'chrome-real-gpu/compat/boxes.png is missing. Make it: bun run test:images -g "boxes on compat", then bun run images:review --accept boxes',
		]);
	});

	it('name a missing SwiftShader reference, and the run with CI=1 that makes it', () => {
		expect(referenceFileProblems(RUNS, without('chromium-swiftshader/webgl2/boxes.png'))).toEqual([
			'chromium-swiftshader/webgl2/boxes.png is missing. Make it: CI=1 bun run test:images -g "boxes on webgl2", then bun run images:review --accept boxes',
		]);
	});

	it("name a device's missing reference, made by the checks plan on that device", () => {
		expect(referenceFileProblems(RUNS, without('ipad/webgpu/grid.png'))).toEqual([
			'ipad/webgpu/grid.png is missing. Make it: run the checks plan on ipad (.dev/devices.md), then bun run images:review --accept grid',
		]);
	});

	it('give the command of a run that the image page does not draw, without and with CI', () => {
		const command =
			'{ci}bun run test:browser image/cli-script.spec.ts -g "cli on webgl2", then bun run images:review --accept cli';
		const cli = {
			...run('boxes-webgl2-pipelined'),
			id: 'cli-webgl2',
			test: 'cli',
			reference: { test: 'cli', tier: 'webgl2' as const, devices: [] },
			make: command,
		};
		expect(referenceFileProblems([cli], [])).toEqual([
			`chrome-real-gpu/webgl2/cli.png is missing. Make it: ${command.replace('{ci}', '')}`,
			`chromium-swiftshader/webgl2/cli.png is missing. Make it: ${command.replace('{ci}', 'CI=1 ')}`,
		]);
	});

	it('name every missing reference of a new test, both sets', () => {
		const problems = referenceFileProblems(
			RUNS,
			NEEDED.filter((file) => !file.endsWith('grid.png')),
		);
		expect(problems.map((problem) => problem.split(' ')[0])).toEqual([
			'chrome-real-gpu/webgpu/grid.png',
			'chromium-swiftshader/webgpu/grid.png',
			'ipad/webgpu/grid.png',
		]);
	});

	it("need a device's references only on the tiers that the device draws", () => {
		const phoneRuns = imageRuns([{ ...(TESTS[0] as ImageTest), devices: ['sm-s926b'] }]);
		const boxes = NEEDED.filter((file) => file.endsWith('/boxes.png'));
		expect(referenceFileProblems(phoneRuns, boxes)).toEqual([
			'sm-s926b/webgl2/boxes.png is missing. Make it: run the checks plan on sm-s926b (.dev/devices.md), then bun run images:review --accept boxes',
		]);
		expect(referenceFileProblems(phoneRuns, [...boxes, 'sm-s926b/webgl2/boxes.png'])).toEqual([]);
	});

	it("need no references of its own for a device that shares another device's", () => {
		const phoneRuns = imageRuns([
			{ ...(TESTS[0] as ImageTest), devices: ['sm-s926b', 'sm-s921b'] },
		]);
		const boxes = NEEDED.filter((file) => file.endsWith('/boxes.png'));
		expect(referenceFileProblems(phoneRuns, [...boxes, 'sm-s926b/webgl2/boxes.png'])).toEqual([]);
	});

	it('name files that no test compares with: a tier that draws the first tier image, a device the test does not list, a test the manifest lacks', () => {
		const unused = [
			'chrome-real-gpu/webgl2/grid.png',
			'mac/webgpu/boxes.png',
			'chrome-real-gpu/webgpu/boxes-copied.png',
			'chromium-swiftshader/webgpu/gone.png',
		];
		expect(referenceFileProblems(RUNS, [...NEEDED, ...unused])).toEqual(
			unused
				.toSorted()
				.map(
					(file) => `${file} is a reference of no test. Delete it, or add its test to the manifest`,
				),
		);
	});
});

describe('the other drawings that a test records', () => {
	/** A test of one scene that keeps the two pictures of the linux device, on WebGL2. */
	const tied = (otherDrawings: readonly OtherDrawing[]): readonly ImageTest[] => [
		{
			name: 'tied',
			sketch: 'sketches/tied.ts',
			hold: 0,
			size: [20, 20],
			tiers: ['webgl2'],
			devices: ['linux'],
			otherDrawings,
		},
	];
	const primary = 'linux/webgl2/tied.png';
	const second = 'linux/webgl2/tied.2.png';
	const digest = 'a'.repeat(64);
	const drawing = (over: Partial<OtherDrawing> = {}): OtherDrawing => ({
		place: 'linux',
		tier: 'webgl2',
		file: second,
		sha256: digest,
		reason: 'a tied sample row',
		...over,
	});

	/** A 20 x 20 image of one colour, with an optional square block of another. */
	const picture = (
		at?: readonly [number, number],
		size = 1,
		rgb: readonly number[] = [200, 10, 10],
	) => {
		const width = 20;
		const height = 20;
		const data = new Uint8Array(width * height * 4);
		for (let i = 0; i < data.length; i += 4) data.set([10, 20, 30, 255], i);
		if (at) {
			for (let y = at[1]; y < at[1] + size; y++)
				for (let x = at[0]; x < at[0] + size; x++) data.set([...rgb, 255], (y * width + x) * 4);
		}
		return { width, height, data };
	};
	const problemsOf = (
		drawings: readonly OtherDrawing[],
		pictures: Readonly<Record<string, ReturnType<typeof picture>>>,
		digests: Readonly<Record<string, string>> = { [second]: digest },
	) =>
		otherDrawingProblems(
			imageRuns(tied(drawings)),
			(file) => digests[file],
			(file) => pictures[file],
		);

	it('pass while a picture differs only outside the guarded end rows and columns', () => {
		expect(problemsOf([drawing()], { [primary]: picture(), [second]: picture([3, 3]) })).toEqual(
			[],
		);
	});

	it('name a picture that differs inside the guarded end rows and columns', () => {
		expect(
			problemsOf([drawing()], { [primary]: picture(), [second]: picture([14, 14], 2) }),
		).toEqual([
			'tied: linux/webgl2/tied.2.png differs from linux/webgl2/tied.png in 2.500% of the guarded end rows and columns, and at most 0.100% may: an extra drawing must not absorb a fringe',
		]);
	});

	it('name a picture that differs nowhere outside the guarded end rows and columns', () => {
		expect(problemsOf([drawing()], { [primary]: picture(), [second]: picture() })).toEqual([
			'tied: linux/webgl2/tied.2.png differs from linux/webgl2/tied.png nowhere outside the guarded end rows and columns',
		]);
	});

	it('name a digest that does not match, and skip a missing file that the reference check names', () => {
		expect(
			problemsOf(
				[drawing()],
				{ [primary]: picture(), [second]: picture([3, 3]) },
				{
					[second]: 'b'.repeat(64),
				},
			),
		).toEqual([
			`tied: linux/webgl2/tied.2.png has SHA-256 ${'b'.repeat(64)}, not the recorded ${digest}`,
		]);
		expect(problemsOf([drawing()], { [primary]: picture() }, {})).toEqual([]);
	});

	it('name a second drawing, a place or tier the test does not keep, the primary file, and a reason or digest that is missing', () => {
		const two = [drawing(), drawing({ file: 'linux/webgl2/tied.3.png' })];
		const outside = drawing({ place: 'mac' });
		const wrongTier = drawing({ tier: 'webgpu' });
		const sameFile = drawing({ file: primary });
		const noReason = drawing({ reason: ' ' });
		const noDigest = drawing({ sha256: 'short' });
		expect(
			problemsOf(two, { [primary]: picture(), [second]: picture([3, 3]) }).concat(
				problemsOf([outside], { [primary]: picture(), [second]: picture([3, 3]) }),
				problemsOf([wrongTier], { [primary]: picture(), [second]: picture([3, 3]) }),
				problemsOf([sameFile], { [primary]: picture(), [second]: picture([3, 3]) }),
				problemsOf([noReason], { [primary]: picture(), [second]: picture([3, 3]) }),
				problemsOf([noDigest], { [primary]: picture(), [second]: picture([3, 3]) }),
			),
		).toEqual([
			'tied: at most one other drawing may be recorded, not 2',
			'tied: the other drawing linux/webgl2/tied.2.png names the place mac, where the test keeps no pictures of its own',
			"tied: the other drawing linux/webgl2/tied.2.png is on webgpu, and the test's references are on webgl2",
			'tied: the other drawing linux/webgl2/tied.png is the primary reference',
			'tied: the other drawing linux/webgl2/tied.2.png needs a reason',
			'tied: the other drawing linux/webgl2/tied.2.png needs its SHA-256',
		]);
	});

	it('need the second file, and keep the set closed when it is not recorded', () => {
		const runs = imageRuns(tied([drawing()]));
		const primaryFiles = [
			'chrome-real-gpu/webgl2/tied.png',
			'chromium-swiftshader/webgl2/tied.png',
			'linux/webgl2/tied.png',
		];
		const files = [...primaryFiles, 'linux/webgl2/tied.2.png'];
		expect(referenceFileProblems(runs, files)).toEqual([]);
		expect(referenceFileProblems(runs, primaryFiles)).toEqual([
			`linux/webgl2/tied.2.png is missing. Make it: run the checks plan on linux (.dev/devices.md), then copy tied's candidate to linux/webgl2/tied.2.png`,
		]);
		expect(referenceFileProblems(runs, [...files, 'linux/webgl2/tied.3.png'])).toEqual([
			'linux/webgl2/tied.3.png is a reference of no test. Delete it, or add its test to the manifest',
		]);
	});
});

describe('the pictures that two tests of one scene keep', () => {
	/**
	 * Two tests of the lights scene on one tier, which differ by the lights they create: `?scene=`
	 * picks a shape of area light. The two are the pair that the guard exists for.
	 */
	const sceneTests: readonly ImageTest[] = [
		{
			name: 'lights-rect',
			sketch: 'sketches/lights.ts?scene=rect',
			hold: 0,
			size: [4, 2],
			tiers: ['webgl2'],
		},
		{
			name: 'lights-tube',
			sketch: 'sketches/lights.ts?scene=tube',
			hold: 0,
			size: [4, 2],
			tiers: ['webgl2'],
		},
	];
	const sceneRuns = imageRuns(sceneTests);
	/** The contents of every reference of the made-up tests, from `pictures` by test name. */
	const contentsOf =
		(pictures: Readonly<Record<string, string>>) =>
		(file: string): string | undefined =>
			pictures[file.split('/').at(-1)?.replace('.png', '') as string];

	it('pass while the area-light scenes draw their own pictures', () => {
		const pictures = { 'lights-rect': 'light', 'lights-tube': 'light elsewhere' };
		expect(sharedReferenceProblems(sceneRuns, contentsOf(pictures))).toEqual([]);
	});

	// The fault that the guard exists for: four area-light scenes shared one black picture, and the
	// one-tier-apart pairs of a single test are no fault at all.
	it('pass while one test draws one picture on two tiers', () => {
		const runs = imageRuns([{ ...(sceneTests[0] as ImageTest), tiers: ['webgpu', 'webgl2'] }]);
		expect(sharedReferenceProblems(runs, contentsOf({ 'lights-rect': 'black' }))).toEqual([]);
	});

	it('name the pair that keeps one picture, with the reference to name', () => {
		const pictures = { 'lights-rect': 'black', 'lights-tube': 'black' };
		expect(sharedReferenceProblems(sceneRuns, contentsOf(pictures))).toEqual([
			"chrome-real-gpu/webgl2/lights-tube.png is the same picture as chrome-real-gpu/webgl2/lights-rect.png: lights-tube and lights-rect draw one scene and must draw it differently. If lights-tube must draw lights-rect's image, name lights-rect in its 'reference'",
			"chromium-swiftshader/webgl2/lights-tube.png is the same picture as chromium-swiftshader/webgl2/lights-rect.png: lights-tube and lights-rect draw one scene and must draw it differently. If lights-tube must draw lights-rect's image, name lights-rect in its 'reference'",
		]);
	});

	it('leave a test that borrows the references of the test it copies', () => {
		const runs = imageRuns([
			sceneTests[0] as ImageTest,
			{ ...(sceneTests[1] as ImageTest), reference: 'lights-rect' },
		]);
		const pictures = { 'lights-rect': 'black', 'lights-tube': 'black' };
		expect(sharedReferenceProblems(runs, contentsOf(pictures))).toEqual([]);
	});

	it('leave the pair that records one picture', () => {
		const runs = imageRuns([
			sceneTests[0] as ImageTest,
			{ ...(sceneTests[1] as ImageTest), samePicture: 'lights-rect' },
		]);
		const pictures = { 'lights-rect': 'black', 'lights-tube': 'black' };
		expect(sharedReferenceProblems(runs, contentsOf(pictures))).toEqual([]);
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
			// CI's own drawing names its run, which a software-GPU reference needs.
			...(ciRunOf(process.env) && { ciRun: ciRunOf(process.env) }),
		});
		expect(readPng(`${saved}.png`)).toEqual(image([10, 20, 30]));
	});

	it('keeps the device facts that the page reported with a candidate', () => {
		const page = pageFactsOf({
			ok: true,
			tier: 'webgpu',
			hdr: true,
			halfPrecision: true,
			multiDraw: false,
			mode: { build: 'threaded', pipelined: true },
			depth: 'reversed',
			clipControl: false,
			drewAsked: true,
			pixels: 'AAAA',
			sketch: { noise: 1 },
		});
		compareWithReference(boxes(), REAL, image([10, 20, 30]), dirs, page);
		const saved = base('chrome-real-gpu', 'webgpu', 'boxes');
		expect(facts(`${saved}.json`)).toMatchObject({
			page: {
				tier: 'webgpu',
				hdr: true,
				halfPrecision: true,
				multiDraw: false,
				mode: { build: 'threaded', pipelined: true },
				depth: 'reversed',
				clipControl: false,
				drewAsked: true,
			},
		});
		// The pixels and the sketch's messages stay out of the facts.
		const written = JSON.stringify(facts(`${saved}.json`));
		expect(written).not.toContain('pixels');
		expect(written).not.toContain('noise');
	});

	it('names the CI run that drew an image only inside GitHub Actions, not in a local CI=1 run', () => {
		expect(ciRunOf({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '40109903483' })).toBe('40109903483');
		expect(ciRunOf({ CI: '1' })).toBeUndefined();
		expect(ciRunOf({ CI: 'true', GITHUB_RUN_ID: '1' })).toBeUndefined();
		expect(ciRunOf({ GITHUB_ACTIONS: 'true' })).toBeUndefined();
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

	/** Runs `save` with the request for drawings on, and puts the setting back afterwards. */
	const asking = (save: () => void) => {
		const kept = process.env.NULL3D_TAKE_IMAGES;
		process.env.NULL3D_TAKE_IMAGES = '1';
		try {
			save();
		} finally {
			if (kept === undefined) delete process.env.NULL3D_TAKE_IMAGES;
			else process.env.NULL3D_TAKE_IMAGES = kept;
		}
	};

	it('keeps no drawing of a passing image unless the run asks for it', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		expect(compareWithReference(boxes(), REAL, image([10, 20, 30]), dirs)).toEqual([]);
		expect(existsSync(dirs.drawn as string)).toBe(false);
	});

	it('keeps the image that a passing run drew when the run asks for its drawings', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		asking(() => {
			expect(compareWithReference(boxes(), REAL, image([10, 20, 30]), dirs)).toEqual([]);
		});
		const saved = join(dirs.drawn as string, 'chrome-real-gpu', 'webgpu', 'boxes');
		// A drawing holds the image and its facts, and no diff or reference copy.
		expect(readdirSync(join(saved, '..')).sort()).toEqual(['boxes.json', 'boxes.png']);
		expect(facts(`${saved}.json`)).toMatchObject({ status: 'drawn', share: 0 });
		expect(readPng(`${saved}.png`)).toEqual(image([10, 20, 30]));
	});

	it('keeps a drawing that differs from its reference, and one that cannot become a reference, with the reason', () => {
		writePng(join(dirs.references, 'chrome-real-gpu/webgpu/boxes.png'), image([10, 20, 30]));
		const drawn = image([10, 20, 30], { at: 5, rgb: [250, 20, 30] });
		asking(() => {
			compareWithReference(boxes(), REAL, drawn, dirs);
			// The copy borrows boxes's reference, so it makes no reference of its own.
			compareWithReference(borrowedRun(boxes(), 'boxes-copied'), REAL, drawn, dirs);
		});
		const saved = join(dirs.drawn as string, 'chrome-real-gpu', 'webgpu');
		expect(readdirSync(saved).sort()).toEqual([
			'boxes-copied.json',
			'boxes-copied.png',
			'boxes.json',
			'boxes.png',
		]);
		expect(facts(join(saved, 'boxes.json'))).toMatchObject({ status: 'drawn', share: 0.125 });
		expect(facts(join(saved, 'boxes-copied.json'))).toMatchObject({
			status: 'drawn',
			reference: 'chrome-real-gpu/webgpu/boxes.png',
			fixed: expect.stringContaining('must draw the image of boxes'),
		});
	});

	it('keeps the drawing of a tier that must draw another tier, with the reason', () => {
		// The grid test's later tiers draw the first tier's picture, so only the first owns a reference.
		asking(() => compareWithReference(run('grid-compat'), REAL, image([10, 20, 30]), dirs));
		const saved = join(dirs.drawn as string, 'chrome-real-gpu', 'compat', 'grid.json');
		expect(facts(saved)).toMatchObject({
			status: 'drawn',
			tier: 'compat',
			reference: 'chrome-real-gpu/webgpu/grid.png',
			fixed: expect.stringContaining('every tier must draw the image of webgpu'),
		});
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

describe('the two drawings of the Firefox render-scale picture', () => {
	const firefox: Place = { runner: 'linux-firefox', device: 'linux' };
	const wrapped = IMAGE_RUNS.find(
		(candidate) => candidate.test === 'render-scale-75-fxaa' && candidate.tier === 'webgl2',
	);
	if (!wrapped) throw new Error('the manifest has no render-scale-75-fxaa on webgl2');
	const references = join(REPO_ROOT, 'tests/image/references');
	const fileOf = (name: string) => join(references, name);
	const primary = 'linux/webgl2/render-scale-75-fxaa.png';
	const second = 'linux/webgl2/render-scale-75-fxaa.2.png';
	const realDirs = (): HarnessDirs => ({
		references,
		candidates: dirs.candidates,
		drawn: dirs.drawn,
	});

	/** A copy of an image, so a test can change it without touching the reference. */
	const copy = (image: ReturnType<typeof readPng>) => ({
		width: image.width,
		height: image.height,
		data: new Uint8Array(image.data),
	});

	/** `save` with the request for drawings on, and the setting put back afterwards. */
	const asking = (save: () => void) => {
		const kept = process.env.NULL3D_TAKE_IMAGES;
		process.env.NULL3D_TAKE_IMAGES = '1';
		try {
			save();
		} finally {
			if (kept === undefined) delete process.env.NULL3D_TAKE_IMAGES;
			else process.env.NULL3D_TAKE_IMAGES = kept;
		}
	};

	it('records the second picture as the other drawing of the linux device', () => {
		expect(referenceOf(wrapped, firefox)).toEqual({
			file: primary,
			others: [second],
			tolerance: TOLERANCE,
		});
		// The manifest's digest is the file's own, so the accepted picture cannot drift.
		expect(wrapped.otherDrawings?.[0]?.sha256).toBe(
			createHash('sha256')
				.update(readFileSync(fileOf(second)))
				.digest('hex'),
		);
		expect(wrapped.otherDrawings?.[0]?.sha256).toBe(
			'b5ffd9a9b60fed696d5f98b361505f23a1166443daf6b3a32c1c3ba84305e708',
		);
	});

	it('passes the candidate picture as the other drawing, and records which picture matched', () => {
		const candidate = readPng(fileOf(second));
		asking(() => {
			expect(compareWithReference(wrapped, firefox, candidate, realDirs())).toEqual([]);
		});
		const saved = JSON.parse(
			readFileSync(
				join(dirs.drawn as string, 'linux-firefox/webgl2/render-scale-75-fxaa.json'),
				'utf8',
			),
		) as CandidateFacts;
		expect(saved).toMatchObject({
			status: 'drawn',
			reference: second,
			matched: second,
			share: 0,
			shares: [
				{ reference: primary, share: 0.004548611111111111 },
				{ reference: second, share: 0 },
			],
		});
	});

	it('passes the primary picture too, and names it as the one that matched', () => {
		const reference = readPng(fileOf(primary));
		asking(() => {
			expect(compareWithReference(wrapped, firefox, reference, realDirs())).toEqual([]);
		});
		const saved = JSON.parse(
			readFileSync(
				join(dirs.drawn as string, 'linux-firefox/webgl2/render-scale-75-fxaa.json'),
				'utf8',
			),
		) as CandidateFacts;
		expect(saved).toMatchObject({ reference: primary, matched: primary, share: 0 });
	});

	it('fails a third drawing that is apart from both pictures', () => {
		const third = copy(readPng(fileOf(second)));
		for (let y = 40; y < 80; y++)
			for (let x = 100; x < 140; x++) third.data.set([255, 0, 255, 255], (y * 320 + x) * 4);
		const [problem] = compareWithReference(wrapped, firefox, third, realDirs());
		expect(problem).toContain(
			'of pixels differ from the closest accepted drawing linux/webgl2/render-scale-75-fxaa.2.png, and at most 0.100% may',
		);
		expect(problem).toContain(`${second} 2.776%`);
		expect(problem).toContain(`${primary} 3.231%`);
	});

	it("fails a fringe added to the image's last rows and columns", () => {
		const fringed = copy(readPng(fileOf(second)));
		for (let y = 0; y < 180; y++)
			for (let x = 0; x < 320; x++)
				if (y >= 177 || x >= 317) fringed.data.set([255, 0, 255, 255], (y * 320 + x) * 4);
		const [problem] = compareWithReference(wrapped, firefox, fringed, realDirs());
		expect(problem).toContain(
			'of pixels differ from the closest accepted drawing linux/webgl2/render-scale-75-fxaa.2.png',
		);
	});

	it('holds the recorded set: the digest matches and the pictures agree in the guarded end', () => {
		expect(otherDrawingProblems(IMAGE_RUNS)).toEqual([]);
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
