// The image test harness. The manifest (tests/image/manifest.ts) lists the image tests, and this
// module turns each test into page loads, one per GPU tier and thread mode. It checks what each page
// publishes, and compares the page's image with the reference of the place that drew it.
//
// Playwright's runs in Chrome compare with the references of their environment. The device runner's
// runs in other browsers compare with the real-GPU references at a looser device tolerance, or with
// a device's own references where a test records that the device's GPU draws it differently. An
// image without a reference, or one that differs from its reference, becomes a candidate under
// test-results/images/, with its diff. Only the review step (tests/review-images.ts) turns a
// candidate into a reference.
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import pixelmatch from 'pixelmatch';
import { percent, type RgbaImage, TIERS, type Tier } from '../../bench/lib/parity.ts';
import { ENVIRONMENTS, type Environment } from '../../packages/cli/src/browser.js';
import { readPng, writePng } from '../../packages/cli/src/png.js';
import {
	ENGINE_MODES,
	type EngineMode,
	type EngineModeName,
	modeProblems,
	type ReportedMode,
} from './engine-checks.ts';
import { type ItemResult, slug } from './runs.ts';
import { REPO_ROOT } from './server.ts';

// Each environment keeps a full set of references, one folder each: Chromium on SwiftShader, the
// software GPU that CI draws with, and Chrome on the real GPU of the Mac that makes the references.
// The two differ at object edges.
export { ENVIRONMENTS, type Environment, readPng, TIERS, type Tier, writePng };

/** The environment whose references other browsers and devices compare with. */
export const REAL_GPU: Environment = 'chrome-real-gpu';

/** How far an image may stray from its reference. */
export interface Tolerance {
	/**
	 * How far a pixel's color may move before the pixel counts as different, from 0 to 1, by
	 * pixelmatch's measure of color distance. Pixels on anti-aliased edges never count.
	 */
	threshold: number;
	/** The share of pixels that may differ, from 0 to 1. */
	maxDiffRatio: number;
}

/** The tolerance against the references of the place that drew the image. */
export const TOLERANCE: Tolerance = { threshold: 0.1, maxDiffRatio: 0.001 };

/**
 * The tolerance of other browsers and devices against the real-GPU references, for GPUs that
 * rasterize edges a little differently. SwiftShader differs from the Mac's GPU in up to 0.33% of
 * S1's pixels, at box edges. Safari and Firefox on the Mac draw Chrome's images there. A test whose
 * scene covers little of its frame records a tighter tolerance, so a frame that lost it still fails.
 */
export const DEVICE_TOLERANCE: Tolerance = { threshold: 0.1, maxDiffRatio: 0.005 };

/** The size of a sketch test's image, unless its entry gives another. */
export const SKETCH_SIZE = [320, 180] as const;

/** How long a page may take to publish its image, unless its entry gives another time. */
const TIMEOUT_SECONDS = 30;

/** The page that draws each sketch test. */
export const IMAGE_PAGE = '/tests/pages/image.html';

/** Settings that every kind of image test takes. */
interface ImageTestSettings {
	/** The test's name, which names its reference images: lowercase words joined by dashes. */
	name: string;
	/** The GPU tiers the test draws on; all three unless it lists fewer. */
	tiers?: readonly Tier[];
	/** Page switches besides the tier, the thread mode and the hold time, such as 'uploads=copy'. */
	switches?: readonly string[];
	/**
	 * Another test whose references this one must match: the same scene drawn another way, such as
	 * with another switch. The other test alone makes those references.
	 */
	reference?: string;
	/** True when every tier must draw the image of the first tier listed, which alone has references. */
	sameOnEveryTier?: boolean;
	/** Values that fields of the page's result must have, besides the image. */
	expect?: Readonly<Record<string, unknown>>;
	/** How far the image may stray from the references of the place that drew it. */
	tolerance?: Partial<Tolerance>;
	/** How far an image from another browser or device may stray from the real-GPU references. */
	deviceTolerance?: Partial<Tolerance>;
	/** Devices whose GPU draws the test differently, which keep their own references, such as 'ipad'. */
	devices?: readonly string[];
	/** How long a page may take to publish its image, in seconds; 30 unless the entry gives another. */
	timeoutSeconds?: number;
}

/** A sketch that the image page draws in the engine's hold mode. */
export interface SketchTest extends ImageTestSettings {
	/** The sketch module, from the repository root. A query after its path reaches the sketch. */
	sketch: string;
	/** The sketch time to hold at, in seconds. */
	hold: number;
	/** The image's size in pixels, [width, height]; 320 x 180 unless the entry gives another. */
	size?: readonly [number, number];
	/** The thread modes to draw in; pipelined unless the entry lists others. */
	modes?: readonly EngineModeName[];
}

/** A test page that draws and publishes an image itself. */
export interface PageTest extends ImageTestSettings {
	/** The page, from the repository root. */
	page: string;
	/** The size in pixels, [width, height], of the image that the page publishes. */
	size: readonly [number, number];
	/** The sketch time that the page holds at, for a page that starts the engine in hold mode. */
	hold?: number;
	/** The thread modes, for a page that starts the engine; none for a page that draws without it. */
	modes?: readonly EngineModeName[];
}

export type ImageTest = SketchTest | PageTest;

/** Every thread mode's name, for a test that draws in all of them. */
export const ALL_MODES: readonly EngineModeName[] = ENGINE_MODES.map(({ name }) => name);

/** One page load of an image test, with everything that judging its result needs. */
export interface ImageRun {
	/** A name for the run that is unique in the manifest: the test, the tier and the mode. */
	id: string;
	/** The test's name. */
	test: string;
	tier: Tier;
	/** The thread mode, for a page that starts the engine. */
	mode?: EngineMode;
	/** The page with its switches, from the server's root. */
	path: string;
	timeoutSeconds: number;
	size: readonly [number, number];
	/** The sketch time the engine must hold at. */
	hold?: number;
	expect: Readonly<Record<string, unknown>>;
	/** Whose references the run compares with: the test and the tier that make them. */
	reference: { test: string; tier: Tier; devices: readonly string[] };
	tolerance: Tolerance;
	deviceTolerance: Tolerance;
	/** The run of the test's first mode on the same tier, whose pixels every other mode must match. */
	sameAs?: string;
}

/** The tier the engine reports for each value of the ?gpu= switch. */
export const REPORTED_TIERS: Readonly<Record<Tier, string>> = {
	webgpu: 'webgpu',
	compat: 'webgpu-compat',
	webgl2: 'webgl2',
};

/** The tiers a test draws on. */
export const tiersOf = (test: ImageTest): readonly Tier[] => test.tiers ?? TIERS;

const sizeOf = (test: ImageTest) => test.size ?? SKETCH_SIZE;

/** A test's thread modes: pipelined for a sketch unless it lists others, and none for a bare page. */
function modesOf(test: ImageTest): readonly (EngineMode | undefined)[] {
	const names = test.modes ?? ('sketch' in test ? ['pipelined'] : []);
	if (names.length === 0) return [undefined];
	return names.map((name) => ENGINE_MODES.find((mode) => mode.name === name) as EngineMode);
}

/** A switch value with the characters that would end it escaped. Slashes stay, for easy reading. */
const switchValue = (value: string) => encodeURIComponent(value).replaceAll('%2F', '/');

/** The page of one run, with its switches. A sketch test's sketch comes last, as the longest switch. */
function pathOf(test: ImageTest, tier: Tier, mode: EngineMode | undefined): string {
	const [width, height] = sizeOf(test);
	const switches = [
		`gpu=${tier}`,
		mode?.query,
		test.hold === undefined ? undefined : `hold=${test.hold}`,
		...(test.switches ?? []),
		...('sketch' in test
			? [`size=${width}x${height}`, `sketch=${switchValue(`/${test.sketch}`)}`]
			: []),
	].filter(Boolean);
	return `${'sketch' in test ? IMAGE_PAGE : `/${test.page}`}?${switches.join('&')}`;
}

/**
 * Every run of these tests: each test on each of its tiers, in each of its thread modes. Throws when
 * a test compares with the references of a test that the list lacks.
 */
export function imageRuns(tests: readonly ImageTest[]): ImageRun[] {
	const byName = new Map(tests.map((test) => [test.name, test]));
	return tests.flatMap((test) => {
		const owner = test.reference === undefined ? test : byName.get(test.reference);
		if (!owner)
			throw new Error(
				`${test.name} compares with the references of ${test.reference}, which the manifest lacks`,
			);
		return tiersOf(test).flatMap((tier) => {
			const modes = modesOf(test);
			const idOf = (mode: EngineMode | undefined) =>
				[test.name, tier, mode && slug(mode.name)].filter(Boolean).join('-');
			return modes.map((mode, index) => ({
				id: idOf(mode),
				test: test.name,
				tier,
				...(mode && { mode }),
				path: pathOf(test, tier, mode),
				timeoutSeconds: test.timeoutSeconds ?? TIMEOUT_SECONDS,
				size: sizeOf(test),
				...(test.hold !== undefined && { hold: test.hold }),
				expect: test.expect ?? {},
				reference: {
					test: owner.name,
					tier: owner.sameOnEveryTier ? (tiersOf(owner)[0] as Tier) : tier,
					devices: owner.devices ?? [],
				},
				tolerance: { ...TOLERANCE, ...test.tolerance },
				deviceTolerance: { ...DEVICE_TOLERANCE, ...test.deviceTolerance },
				...(index > 0 && { sameAs: idOf(modes[0]) }),
			}));
		});
	});
}

/** Names that become folders and files: lowercase words joined by dashes. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What is wrong with a list of image tests: names that are not unique or not plain, empty or
 * repeated tiers and modes, bad sizes and hold times, and references to tests that cannot supply
 * them. `exists` says whether a file exists, from the repository root.
 */
export function manifestProblems(
	tests: readonly ImageTest[],
	exists: (file: string) => boolean = (file) => existsSync(join(REPO_ROOT, file)),
): string[] {
	const problems: string[] = [];
	const byName = new Map<string, ImageTest>();
	for (const test of tests) {
		const { name } = test;
		if (byName.has(name)) problems.push(`two tests are named ${name}`);
		else byName.set(name, test);
		if (!NAME.test(name)) problems.push(`${name}: use lowercase words joined by dashes`);
		const tiers = tiersOf(test);
		if (tiers.length === 0 || new Set(tiers).size !== tiers.length)
			problems.push(`${name}: list each tier once, and at least one`);
		if (test.modes && new Set(test.modes).size !== test.modes.length)
			problems.push(`${name}: list each thread mode once`);
		if ('sketch' in test && test.modes?.length === 0)
			problems.push(`${name}: a sketch draws in at least one thread mode`);
		const [width, height] = sizeOf(test);
		if (!(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0))
			problems.push(`${name}: the size must be whole pixels, not ${width} x ${height}`);
		if (test.hold !== undefined && !(test.hold >= 0 && test.hold <= 600))
			problems.push(`${name}: hold at 0 to 600 seconds, not ${test.hold}`);
		const file = ('sketch' in test ? test.sketch : test.page).split('?')[0] as string;
		if (!exists(file)) problems.push(`${name}: ${file} does not exist`);
		for (const device of test.devices ?? [])
			if (!NAME.test(device))
				problems.push(`${name}: the device ${device} is not a runner's device`);
	}
	for (const test of tests) {
		if (test.reference === undefined) continue;
		const owner = byName.get(test.reference);
		if (!owner || owner === test) {
			problems.push(`${test.name}: the reference ${test.reference} must name another test`);
			continue;
		}
		if (owner.reference !== undefined) {
			problems.push(`${test.name}: ${owner.name} borrows its references, so it cannot lend them`);
			continue;
		}
		if (sizeOf(owner).join('x') !== sizeOf(test).join('x'))
			problems.push(`${test.name}: its size differs from ${owner.name}'s`);
		const drawn = owner.sameOnEveryTier ? [] : tiersOf(test);
		for (const tier of drawn.filter((tier) => !tiersOf(owner).includes(tier)))
			problems.push(`${test.name}: ${owner.name} has no references on ${tier}`);
	}
	return problems;
}

/**
 * Where an image was drawn: in an environment of Playwright's runs, or by a runner of the device
 * runner, such as mac-safari on the device mac.
 */
export type Place = { environment: Environment } | { runner: string; device: string };

/** The folder name of the place that drew an image: its environment, or its runner. */
export const drawnIn = (place: Place) =>
	'environment' in place ? place.environment : place.runner;

/** The reference that a run's image compares with in a place. */
export interface Reference {
	/** The file, from the folder of references. */
	file: string;
	tolerance: Tolerance;
	/** Why an image from this place cannot become this reference; absent when it can. */
	fixed?: string;
}

/**
 * The reference a run's image compares with where it was drawn. An environment compares with its
 * own references. A device compares with its own references where the test records it, and with
 * the real-GPU references at the device tolerance elsewhere.
 */
export function referenceOf(run: ImageRun, place: Place): Reference {
	const own = 'environment' in place || run.reference.devices.includes(place.device);
	const set = 'environment' in place ? place.environment : own ? place.device : REAL_GPU;
	const file = `${set}/${run.reference.tier}/${run.reference.test}.png`;
	const reference = { file, tolerance: own ? run.tolerance : run.deviceTolerance };
	if (!own && 'device' in place)
		return {
			...reference,
			fixed: `other browsers and devices compare with the real-GPU references. If the GPU of ${place.device} draws ${run.test} another way, add '${place.device}' to the test's devices in tests/image/manifest.ts, and its next run saves this device's own reference`,
		};
	if (run.reference.test !== run.test)
		return {
			...reference,
			fixed: `${run.test} must draw the image of ${run.reference.test}, which alone makes this reference`,
		};
	if (run.reference.tier !== run.tier)
		return {
			...reference,
			fixed: `every tier must draw the image of ${run.reference.tier}, which alone makes this reference`,
		};
	return reference;
}

/** The folders of references and of candidates. */
export interface HarnessDirs {
	references: string;
	candidates: string;
}

export const HARNESS_DIRS: HarnessDirs = {
	references: join(REPO_ROOT, 'tests/image/references'),
	candidates: join(REPO_ROOT, 'test-results/images'),
};

/** What a candidate's JSON file records, beside its image. */
export interface CandidateFacts {
	test: string;
	tier: Tier;
	/** The thread mode that drew it, for a page that starts the engine. */
	mode?: string;
	/** The environment or the runner that drew it. */
	drawnIn: string;
	/** New: the image has no reference. Changed: it differs from its reference beyond the tolerance. */
	status: 'new' | 'changed';
	/** The reference it was compared with, from the folder of references. */
	reference: string;
	/** For a changed image, the share of its pixels that differ, from 0 to 1. */
	share?: number;
	tolerance: Tolerance;
	/** Why the image cannot become the reference, when it cannot. */
	fixed?: string;
}

/** The files of one candidate, which differ in their endings. */
export const CANDIDATE_FILES = {
	image: '.png',
	facts: '.json',
	diff: '-diff.png',
	reference: '-reference.png',
} as const;

/** The start of the file names of a run's candidate in a place: the folder and the test's name. */
const candidateBase = (run: ImageRun, place: Place, dirs: HarnessDirs) =>
	join(dirs.candidates, drawnIn(place), run.tier, run.test);

/** Removes the candidate that an earlier run of this test saved in this place on this tier. */
export function clearCandidate(run: ImageRun, place: Place, dirs = HARNESS_DIRS): void {
	const base = candidateBase(run, place, dirs);
	for (const ending of Object.values(CANDIDATE_FILES)) rmSync(`${base}${ending}`, { force: true });
}

/** Removes every candidate that a place saved, as before a runner's results are judged again. */
export function clearCandidates(place: Place, dirs = HARNESS_DIRS): void {
	rmSync(join(dirs.candidates, drawnIn(place)), { recursive: true, force: true });
}

/**
 * Compares a run's image with its reference in the place that drew it. An image without a
 * reference, or beyond the tolerance, is saved as a candidate with the facts of the comparison, and
 * with the reference and the diff when there is one. Returns what is wrong, or nothing.
 */
export function compareWithReference(
	run: ImageRun,
	place: Place,
	image: RgbaImage,
	dirs = HARNESS_DIRS,
): string[] {
	const reference = referenceOf(run, place);
	const referencePath = join(dirs.references, reference.file);
	const base = candidateBase(run, place, dirs);
	const facts: CandidateFacts = {
		test: run.test,
		tier: run.tier,
		...(run.mode && { mode: run.mode.name }),
		drawnIn: drawnIn(place),
		status: 'new',
		reference: reference.file,
		tolerance: reference.tolerance,
		...(reference.fixed && { fixed: reference.fixed }),
	};
	// The first mode that differs keeps its candidate: the later modes of a test on a tier draw the
	// same pixels, or fail for that on their own. The facts go last, so they mark a whole candidate.
	const save = (extra: Partial<CandidateFacts>, diff?: RgbaImage) => {
		if (existsSync(`${base}${CANDIDATE_FILES.facts}`)) return;
		writePng(`${base}${CANDIDATE_FILES.image}`, image);
		if (diff) {
			writePng(`${base}${CANDIDATE_FILES.diff}`, diff);
			copyFileSync(referencePath, `${base}${CANDIDATE_FILES.reference}`);
		}
		writeFileSync(
			`${base}${CANDIDATE_FILES.facts}`,
			`${JSON.stringify({ ...facts, ...extra }, null, '\t')}\n`,
		);
	};
	const shown = relative(REPO_ROOT, `${base}${CANDIDATE_FILES.image}`);
	if (!existsSync(referencePath)) {
		save({});
		return [`there is no reference ${reference.file} yet. The new image is ${shown}`];
	}
	const expected = readPng(referencePath);
	if (expected.width !== image.width || expected.height !== image.height) {
		save({ status: 'changed', share: 1 });
		return [
			`the image is ${image.width} x ${image.height}, and the reference ${reference.file} is ${expected.width} x ${expected.height}. The new image is ${shown}`,
		];
	}
	const diff = new Uint8Array(image.data.length);
	const differing = pixelmatch(expected.data, image.data, diff, image.width, image.height, {
		threshold: reference.tolerance.threshold,
	});
	const share = differing / (image.width * image.height);
	if (share <= reference.tolerance.maxDiffRatio) return [];
	save({ status: 'changed', share }, { width: image.width, height: image.height, data: diff });
	return [
		`${percent(share)} of pixels differ from the reference ${reference.file}, and at most ${percent(reference.tolerance.maxDiffRatio)} may. The new image is ${shown}, and the diff ${relative(REPO_ROOT, `${base}${CANDIDATE_FILES.diff}`)}`,
	];
}

/** The image in a page's result, or what is wrong with it. */
function imageOf(
	result: ItemResult,
	[width, height]: readonly [number, number],
): RgbaImage | string {
	if (result.width !== width || result.height !== height)
		return `the image is ${String(result.width)} x ${String(result.height)} pixels, not ${width} x ${height}`;
	if (typeof result.pixels !== 'string') return 'the result has no pixels';
	const data = new Uint8Array(Buffer.from(result.pixels, 'base64'));
	if (data.length !== width * height * 4)
		return `the image holds ${data.length} bytes, not the ${width * height * 4} of ${width} x ${height} RGBA8 pixels`;
	return { width, height, data };
}

/** How many pixels of two images of one size differ at all. */
function differentPixels(a: Uint8Array, b: Uint8Array): number {
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
			count++;
	return count;
}

/** Whether a GPU adapter's description names a software GPU. */
const softwareAdapter = (adapter: string) => adapter.toLowerCase().includes('swiftshader');

/**
 * What is wrong with the result of a run whose page published its image: GPU errors, another tier
 * or thread mode than the switches asked for, another hold time, fields without their expected
 * values, and the image against its reference. `first` is the result of the test's first mode on
 * the same tier, whose pixels this mode must match byte for byte: a thread mode changes when the
 * engine draws a frame, never what it draws. Real-GPU runs refuse a software GPU, which would hide
 * real GPU faults.
 */
export function imageProblems(
	run: ImageRun,
	result: ItemResult,
	place: Place,
	first?: ItemResult,
	dirs = HARNESS_DIRS,
): string[] {
	const problems = ((result.errors ?? []) as string[]).map((error) => `GPU error: ${error}`);
	const tier = REPORTED_TIERS[run.tier];
	if (typeof result.tier === 'string' && result.tier !== tier)
		problems.push(`drew on ${result.tier}, not ${tier}`);
	// A page that makes its own WebGPU device reports whether the device has core features. Chrome
	// offers compatibility mode, so there a device that did not ask for them has none. Safari and
	// Firefox have no compatibility mode, and give every device core features.
	if (result.core === false && run.tier === 'webgpu')
		problems.push('the device lacks core features');
	if (result.core === true && run.tier === 'compat' && 'environment' in place)
		problems.push('the device has core features, so it drew outside compatibility mode');
	if ('environment' in place && place.environment === REAL_GPU) {
		const adapter = typeof result.adapter === 'string' ? result.adapter : '';
		if (softwareAdapter(adapter)) problems.push(`drew on a software GPU: ${adapter}`);
	}
	const mode = result.mode as (ReportedMode & { hold?: number | null }) | undefined;
	if (run.mode)
		problems.push(...(mode ? modeProblems(mode, run.mode) : ['the page reported no thread mode']));
	if (run.hold !== undefined && mode?.hold !== run.hold)
		problems.push(
			typeof mode?.hold === 'number'
				? `held at ${mode.hold} seconds, not ${run.hold}`
				: `the engine did not hold at ${run.hold} seconds`,
		);
	for (const [field, value] of Object.entries(run.expect))
		if (!isDeepStrictEqual(result[field], value))
			problems.push(`${field} is ${JSON.stringify(result[field])}, not ${JSON.stringify(value)}`);
	const image = imageOf(result, run.size);
	if (typeof image === 'string') return [...problems, image];
	const firstImage = first && imageOf(first, run.size);
	if (firstImage && typeof firstImage !== 'string') {
		const count = differentPixels(firstImage.data, image.data);
		if (count > 0)
			problems.push(
				`${count} pixels differ from the image of the first thread mode, which every mode must draw`,
			);
	}
	return [...problems, ...compareWithReference(run, place, image, dirs)];
}

/**
 * A run of a behavior test that compares its live engine's image with the references of a
 * manifest run, such as a page that draws the scene again after the GPU is lost. Its candidate
 * carries the behavior test's own name, and cannot become the manifest test's reference.
 */
export function borrowedRun(run: ImageRun, test: string): ImageRun {
	const { sameAs: _first, hold: _hold, ...rest } = run;
	return { ...rest, test, id: `${test}-${run.id}` };
}

/** The environment that a Playwright project's name names. */
export function environmentNamed(project: string): Environment {
	const environment = ENVIRONMENTS.find((name) => name === project);
	if (!environment)
		throw new Error(
			`image tests run in the Playwright projects ${ENVIRONMENTS.join(' and ')}, not ${project}`,
		);
	return environment;
}
