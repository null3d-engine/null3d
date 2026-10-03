// Parity images: hold frames of the benchmark scenes from two kinds of benchmark page, and images of
// the feature scenes from null3D's image tests and their three.js twins, compared with three.js's
// own image rule. Everything here is pure. The parity command (bench/parity.ts), the feature parity
// test (bench/tests/parity.spec.ts) and the runner's parity plan (tests/lib/plans.ts) load the pages
// and write the files.
//
// The rule is the one that three.js's end-to-end test applies to its example screenshots
// (test/e2e/puppeteer.js and test/e2e/image.js in the three.js repository, at the release that the
// benchmark pages use). A pixel differs when the distance between its two RGB colors is more than a
// set share of the distance from black to white. Alpha does not count, and no pixel is excused as
// anti-aliasing. Two images match when strictly less than a set percentage of their pixels differ.
import { percent } from '../../packages/cli/src/compare.js';
import { TIERS, type Tier } from '../../packages/cli/src/page.js';
import { encodePng, type RgbaImage } from '../../packages/cli/src/png.js';
import { STOPS, TONE_MAPPINGS, toneMappingTest } from '../../tests/pages/lib/bright-scene.ts';
import { MODEL_NAMES } from '../scenes/gltf-models.ts';

export { encodePng, percent, type RgbaImage, TIERS, type Tier };

/** A pixel differs when its RGB distance is more than this share of the distance from black to white. */
export const PIXEL_THRESHOLD = 0.1;
/** Two images match when strictly less than this percentage of their pixels differ. */
export const MAX_DIFFERENT_PERCENT = 0.1;
/**
 * The limit for scenes with shadows, which three.js's rule would fail on shadow edges alone. three.js
 * softens each edge with five rotated taps of its shadow map, and null3D with a 3 x 3 filter of a
 * cascade whose texels have another size. The shadows fall in the same places, and only the pixels
 * that an edge crosses differ. `.dev/image-tests.md` records the measured shares.
 */
export const SHADOW_MAX_DIFFERENT_PERCENT = 0.5;

/** The squared RGB distance from black to white, which scales a squared distance to [0, 1]. */
const MAX_SQUARED_DISTANCE = 255 * 255 * 3;
/** A diff image shows each matching pixel at this share of the reference pixel's value. */
const DIFF_DIM = 0.2;
const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;

/** A hold frame that a benchmark page published, and what the page drew. */
export interface HoldFrame extends RgbaImage {
	/** The scene's name, such as s1. */
	scene: string;
	/** The object count that the page drew. */
	n: number;
}

export interface ImageComparison {
	/** Pixels whose colors differ by more than the per-pixel threshold. */
	differentPixels: number;
	/** The differing pixels' share of all pixels, from 0 to 1. */
	share: number;
	/** True when the share is under three.js's limit. */
	pass: boolean;
	/** The reference image dimmed, with each differing pixel in pure red. */
	diff: RgbaImage;
}

// The scenes and the pages that draw their hold frames.

/** Every benchmark scene. The benchmark runs, the page tests and the image tests cover each one. */
export const BENCH_SCENES = ['s1', 's1-static', 's1-cells', 's2', 's3', 's4'] as const;
export type BenchScene = (typeof BENCH_SCENES)[number];

/**
 * Why the parity checks leave a scene out: a feature that its three.js twin draws and null3D does
 * not draw yet, a twin page that cannot draw the scene, or a tier whose frame differs from the
 * twin's by more than the checks allow. Such a scene runs and has image
 * references of its own. The pull request that builds a feature takes it off here, and makes the
 * scene's references again.
 */
export const LEFT_OUT_OF_PARITY: Readonly<Record<BenchScene, readonly string[]>> = {
	s1: [],
	's1-static': [],
	's1-cells': [],
	s2: [],
	// Every check compares with WebGLRenderer's frame, on its tier and in the baseline between
	// three.js's renderers.
	s3: ["WebGLRenderer's shader for 256 point lights, which most GPUs cannot build"],
	s4: [
		"on WebGL2, more pixels that differ from WebGLRenderer's frame than three.js's two renderers differ by",
	],
};

/** The benchmark scenes whose hold frames the parity checks compare with three.js's. */
export const PARITY_SCENES: readonly BenchScene[] = BENCH_SCENES.filter(
	(scene) => LEFT_OUT_OF_PARITY[scene].length === 0,
);

/** The GPU interface a tier draws with: compatibility mode is WebGPU within lower limits. */
export function gpuApiOf(tier: Tier): 'webgpu' | 'webgl2' {
	return tier === 'webgl2' ? 'webgl2' : 'webgpu';
}

/**
 * Each kind of benchmark page: its folder, the switches that pick its GPU path and, for the null3D
 * pages that end in -low, the low-latency mode, for those that end in -cells-off, culling with no
 * grid cells skipped, for those that end in -half, color math at half precision, for those that
 * end in -timed, the time of each WebGL call, and for those that end in -synced, that time with a
 * wait for the browser's GPU process after each call, and the GPU interface it draws with.
 */
const PAGES = {
	'threejs-webgl': { folder: 'threejs', switches: 'renderer=webgl', api: 'webgl2' },
	'threejs-webgpu': { folder: 'threejs', switches: 'renderer=webgpu', api: 'webgpu' },
	'null3d-webgl2': { folder: 'null3d', switches: 'gpu=webgl2', api: 'webgl2' },
	'null3d-webgpu': { folder: 'null3d', switches: 'gpu=webgpu', api: 'webgpu' },
	'null3d-compat': { folder: 'null3d', switches: 'gpu=compat', api: 'webgpu' },
	'null3d-webgpu-low': { folder: 'null3d', switches: 'gpu=webgpu&latency=low', api: 'webgpu' },
	'null3d-webgl2-low': { folder: 'null3d', switches: 'gpu=webgl2&latency=low', api: 'webgl2' },
	'null3d-webgpu-cells-off': { folder: 'null3d', switches: 'gpu=webgpu&cells=off', api: 'webgpu' },
	'null3d-webgl2-cells-off': { folder: 'null3d', switches: 'gpu=webgl2&cells=off', api: 'webgl2' },
	'null3d-webgpu-half': { folder: 'null3d', switches: 'gpu=webgpu&half=on', api: 'webgpu' },
	'null3d-webgl2-half': { folder: 'null3d', switches: 'gpu=webgl2&half=on', api: 'webgl2' },
	'null3d-webgl2-timed': { folder: 'null3d', switches: 'gpu=webgl2&gl-timing', api: 'webgl2' },
	'null3d-webgl2-synced': {
		folder: 'null3d',
		switches: 'gpu=webgl2&gl-timing=sync',
		api: 'webgl2',
	},
} as const satisfies Record<string, { folder: string; switches: string; api: 'webgpu' | 'webgl2' }>;

export type PageKind = keyof typeof PAGES;
export const PAGE_KINDS = Object.keys(PAGES) as PageKind[];

/**
 * The page that runs a scene's shared per-frame code alone, with no engine: the motion and the
 * camera path that every engine's page runs. Its time per frame tells each engine's own work apart
 * from the scene code. It draws nothing, so it has no hold frame.
 */
export const SCENE_CODE = 'scene-code';
/** Every kind of page a benchmark run can time: the engines' pages and the scene code alone. */
export type BenchPageKind = PageKind | typeof SCENE_CODE;
export const BENCH_PAGE_KINDS: readonly BenchPageKind[] = [...PAGE_KINDS, SCENE_CODE];

/**
 * The GPU interface a benchmark page draws with. The scene-code page draws nothing, so it runs
 * wherever the WebGL2 pages run.
 */
export function gpuApiOfPage(kind: BenchPageKind): 'webgpu' | 'webgl2' {
	return kind === SCENE_CODE ? 'webgl2' : PAGES[kind].api;
}

/** True for a null3D page, whose engine takes switches such as `?jobs=`. */
export function isNull3dPage(kind: BenchPageKind): boolean {
	return kind !== SCENE_CODE && PAGES[kind].folder === 'null3d';
}

/** The pages that a sweep of job worker counts runs: both null3D GPU paths, pipelined. */
export const JOBS_PAGES: readonly PageKind[] = ['null3d-webgpu', 'null3d-webgl2'];

/**
 * The job worker counts of a `--jobs` list, such as `1,2,4,8`, each once and in the order given.
 * It throws unless each count is a whole number above 0.
 */
export function readJobCounts(text: string | undefined): number[] {
	const counts = (text ?? '').split(',').filter(Boolean).map(Number);
	if (counts.length === 0 || !counts.every((n) => Number.isSafeInteger(n) && n > 0))
		throw new Error('--jobs: use a comma-separated list of whole numbers above 0, such as 1,2,4,8');
	return [...new Set(counts)];
}

/** Two pages whose frames must match. The diff image dims the reference's frame. */
export interface PagePair {
	candidate: PageKind;
	reference: PageKind;
}

/** On each GPU tier, the null3d page and the three.js page that it must match. */
export const TIER_PAIRS: Readonly<Record<Tier, PagePair>> = {
	webgpu: { candidate: 'null3d-webgpu', reference: 'threejs-webgpu' },
	compat: { candidate: 'null3d-compat', reference: 'threejs-webgpu' },
	webgl2: { candidate: 'null3d-webgl2', reference: 'threejs-webgl' },
};

// The feature scenes and their three.js twins.

/**
 * A feature scene: an image test of the manifest (tests/image/manifest.ts) whose scene a three.js
 * twin page also draws. Both build it from one data module in bench/scenes/.
 */
export interface FeatureScene {
	/** The image test that draws null3D's side. Its name names the scene. */
	test: string;
	/** The twin page's path from the server's root, with its own switches. */
	twin: string;
	/** Switches of the image page for null3D's side, such as `antialias=none`, or none. */
	switches?: string;
	/**
	 * Switches of the test's sketch module for null3D's side, or none: `tone=none` turns off the
	 * engine's default tone mapping, as three.js's twin draws with none. The image test itself keeps
	 * the engine's defaults.
	 */
	sketchSwitches?: string;
	/**
	 * True when only WebGLRenderer draws the twin. Its frame is then the reference on every tier,
	 * and the scene has no baseline between three.js's renderers.
	 */
	webglOnly?: boolean;
	/** The percentage of pixels under which the scene passes, where it is not three.js's limit. */
	limit?: number;
}

const TWINS = '/bench/pages/threejs';
/** The sketch switch that turns off tone mapping, for sketches whose image tests keep ACES. */
const NO_TONE = 'tone=none';

/**
 * The limits of the glTF model scenes whose images three.js's rule would fail for reasons outside
 * the loader, with the largest share measured on the Mac (`.dev/image-tests.md` records them). The
 * lamp's glass uses KHR_materials_transmission, volume and ior, which three.js draws and null3D
 * does not read: 0.87% of the pixels differ, all on the glass and its beads. The instanced cubes
 * have black faces beside white ones at hundreds of edges, which compatibility mode's 8-bit path
 * averages after it encodes the colors: 0.41% differ there, and none on the other tiers.
 */
const MODEL_LIMITS: Partial<Record<(typeof MODEL_NAMES)[number], number>> = {
	ktx2: 1,
	instancing: 0.5,
};

/**
 * Each feature scene that the exit gate's parity covers: standard materials, the light types
 * (point and spot lights, and the directional and ambient lights of the material scenes), fog, tone
 * mapping, the orthographic camera, glTF sample models through the loader, and shadows at their
 * own limit. The engine stores hemisphere
 * lights but does not draw them yet; the lights twin draws `?scene=hemisphere` already, so the pull
 * request that draws them adds that scene's image test here. The tone mappings compare without
 * anti-aliasing: null3D resolves the samples of an edge before it tone maps them, and three.js's
 * WebGLRenderer after, so a bright edge differs by design. The tone mapping spec compares each
 * tile's color with anti-aliasing on.
 */
export const FEATURE_SCENES: readonly FeatureScene[] = [
	{ test: 'standard-grid', twin: `${TWINS}/standard-grid.html`, sketchSwitches: NO_TONE },
	{ test: 'standard-maps', twin: `${TWINS}/material-maps.html` },
	{ test: 'alpha-mask', twin: `${TWINS}/alpha-mask.html` },
	{ test: 'transparency', twin: `${TWINS}/transparency.html` },
	{ test: 'texture-background', twin: `${TWINS}/texture-background.html` },
	{ test: 'lights-16', twin: `${TWINS}/lights.html?lights=16`, sketchSwitches: NO_TONE },
	{ test: 'lights-spot', twin: `${TWINS}/lights.html?scene=spot`, sketchSwitches: NO_TONE },
	{ test: 'fog-linear', twin: `${TWINS}/fog.html?fog=linear` },
	{ test: 'fog-exp2', twin: `${TWINS}/fog.html?fog=exp2` },
	...TONE_MAPPINGS.flatMap((tone) =>
		STOPS.map(
			(stops): FeatureScene => ({
				test: toneMappingTest(tone, stops),
				twin: `${TWINS}/tone-mapping.html?tone=${tone}&stops=${stops}&antialias=none`,
				switches: 'antialias=none',
				webglOnly: true,
			}),
		),
	),
	{ test: 'ortho-camera', twin: `${TWINS}/ortho-camera.html` },
	...MODEL_NAMES.map(
		(model): FeatureScene => ({
			test: `gltf-${model}`,
			twin: `${TWINS}/gltf.html?model=${model}`,
			limit: MODEL_LIMITS[model],
		}),
	),
	{
		test: 'shadows',
		twin: `${TWINS}/shadows.html`,
		sketchSwitches: NO_TONE,
		limit: SHADOW_MAX_DIFFERENT_PERCENT,
	},
	// Bloom at two settings against three.js's UnrealBloomPass. The composer's targets have no MSAA,
	// so null3D's page draws without anti-aliasing too.
	...(['soft', 'strong'] as const).map(
		(bloom): FeatureScene => ({
			test: `bloom-${bloom}`,
			twin: `${TWINS}/bloom.html?bloom=${bloom}`,
			switches: 'antialias=none',
			webglOnly: true,
		}),
	),
	// A color grading table from a .cube file, alone and at part of its intensity with the
	// vignette, against three.js's LUTPass and VignetteShader after its OutputPass. The .3dl test
	// has no twin: three.js's LUT3dlLoader refuses the sample file's grid, whose steps differ by one
	// from rounding.
	{
		test: 'lut-cube',
		twin: `${TWINS}/grading.html`,
		switches: 'antialias=none',
		webglOnly: true,
	},
	{
		test: 'lut-vignette',
		twin: `${TWINS}/grading.html?mix`,
		switches: 'antialias=none',
		webglOnly: true,
	},
];

/** The feature scene of an image test, or undefined when no twin draws that test's scene. */
export function featureScene(test: string): FeatureScene | undefined {
	return FEATURE_SCENES.find((scene) => scene.test === test);
}

/** The path of a feature scene's twin page that draws with one of three.js's renderers. */
export function twinPath({ twin, webglOnly }: FeatureScene, renderer: 'webgl' | 'webgpu'): string {
	return `${twin}${twin.includes('?') ? '&' : '?'}renderer=${webglOnly ? 'webgl' : renderer}`;
}

/** On a tier, the pages whose frames a feature scene compares. */
export function featurePair({ webglOnly }: FeatureScene, tier: Tier): PagePair {
	const pair = TIER_PAIRS[tier];
	return webglOnly ? { ...pair, reference: 'threejs-webgl' } : pair;
}

/** The tier that each null3D page kind of the tiers' comparisons draws a feature scene on. */
const FEATURE_TIERS: Partial<Record<PageKind, Tier>> = {
	'null3d-webgpu': 'webgpu',
	'null3d-compat': 'compat',
	'null3d-webgl2': 'webgl2',
};

/**
 * The path of the page of one kind that draws a feature scene: the twin for three.js's kinds, and
 * for a null3D kind, the image test on that kind's tier with the scene's sketch switches, from
 * `imagePath` (`featureImagePath` in tests/image/manifest.ts), and with the scene's
 * switches. The other null3D kinds, such as the low-latency ones, draw no feature scene, so they
 * get null.
 */
export function featurePagePath(
	scene: FeatureScene,
	kind: PageKind,
	imagePath: (tier: Tier) => string,
): string | null {
	if (kind === 'threejs-webgl') return twinPath(scene, 'webgl');
	if (kind === 'threejs-webgpu') return twinPath(scene, 'webgpu');
	const tier = FEATURE_TIERS[kind];
	if (tier === undefined) return null;
	return [imagePath(tier), scene.switches].filter(Boolean).join('&');
}

/** The dev-server path of one scene's page of one kind, with more switches after its own. */
export function pagePath(scene: BenchScene, kind: BenchPageKind, switches = ''): string {
	const page = kind === SCENE_CODE ? { folder: SCENE_CODE, switches: '' } : PAGES[kind];
	return `/bench/pages/${page.folder}/${scene}.html?${[page.switches, switches].filter(Boolean).join('&')}`;
}

/**
 * The quality preset switch of every page whose frame a test compares with an image from elsewhere.
 * The references and three.js's frames come from desktops, where the engine chooses High within
 * each GPU path's ceiling. A phone or a tablet would choose a lighter preset, whose anti-aliasing
 * and anisotropy change the image, so each such page names High and every device draws the
 * desktop's settings. The switch also keeps the engine's crash marker from lowering the preset.
 */
export const REFERENCE_PRESET_SWITCH = 'preset=high';

/**
 * The dev-server path of the page that draws one scene's hold frame, at the references' preset, with
 * more switches. A three.js twin that copies the preset's settings reads the same switch.
 */
export function holdPagePath(scene: BenchScene, kind: PageKind, switches = ''): string {
	return pagePath(
		scene,
		kind,
		['hold', REFERENCE_PRESET_SWITCH, switches].filter(Boolean).join('&'),
	);
}

/**
 * The page switches of a command's `option`, such as `--switches shadows=3`: names, each with a
 * value or none, joined by `&`. It throws unless the text has that form.
 */
export function readSwitches(text: string | undefined, option: string): string {
	if (!text || !/^[a-z]+(=[\w.]+)?(&[a-z]+(=[\w.]+)?)*$/i.test(text))
		throw new Error(`${option}: give page switches without the ?, such as shadows=3 or a=1&b`);
	return text;
}

/** The name that a comparison's image files start with. */
export function comparisonName(scene: string, { candidate, reference }: PagePair): string {
	return `${scene}-${candidate}-vs-${reference}`;
}

/** three.js's two renderers: how much their frames differ is the baseline for engine comparisons. */
export const BASELINE_PAIR: PagePair = { candidate: 'threejs-webgl', reference: 'threejs-webgpu' };

/** Where `bun run parity --save-baselines` keeps the stored baselines, from the repository root. */
export const STORED_BASELINES_FILE = 'bench/parity-baselines.json';

/**
 * How much three.js's two renderers differ on each scene's hold frame, as last measured on a device
 * that draws with both. A device that has only one of them, such as a phone without WebGPU, compares
 * with these instead.
 */
export type StoredBaselines = Partial<Record<BenchScene, number>>;

/** The stored baselines in a file's text; unknown scenes and values that are not a share drop out. */
export function parseStoredBaselines(text: string): StoredBaselines {
	const scenes = (JSON.parse(text) as { scenes?: Record<string, unknown> }).scenes ?? {};
	const baselines: StoredBaselines = {};
	for (const scene of BENCH_SCENES) {
		const share = scenes[scene];
		if (typeof share === 'number' && share >= 0 && share <= 1) baselines[scene] = share;
	}
	return baselines;
}

/** The file's text for stored baselines, in scene order. */
export function formatStoredBaselines(baselines: StoredBaselines): string {
	const scenes: StoredBaselines = {};
	for (const scene of BENCH_SCENES) {
		const share = baselines[scene];
		if (share !== undefined) scenes[scene] = share;
	}
	const note =
		"How much three.js's two renderers differ on each scene's hold frame, as a share of pixels. Written by `bun run parity --save-baselines`.";
	return `${JSON.stringify({ note, scenes }, null, '\t')}\n`;
}

/**
 * True when a comparison of two engines passes: under three.js's limit, or no worse than three.js's
 * own two renderers differ on the same frame. Rasterizers disagree on edges and on objects one or
 * two pixels wide, and three.js's rule counts every such pixel. An engine that matches three.js as
 * closely as three.js's renderers match each other draws the same scene.
 */
export function passesWithBaseline(
	share: number,
	baselineShare: number | null,
	limitPercent = MAX_DIFFERENT_PERCENT,
): boolean {
	return share * 100 < limitPercent || (baselineShare !== null && share <= baselineShare);
}

/**
 * How much two images differ, and what may differ, in words for a report. A `stored` baseline was
 * measured on another device, because this one cannot draw with both of three.js's renderers. A
 * scene with a limit of its own, such as a scene with shadows, names it as the scene's limit.
 */
export function differenceText(
	{ share }: Pick<ImageComparison, 'share'>,
	baselineShare: number | null = null,
	stored = false,
	limitPercent = MAX_DIFFERENT_PERCENT,
): string {
	const rule = limitPercent === MAX_DIFFERENT_PERCENT ? "three.js's rule" : "the scene's limit";
	const limit = `${percent(share)} of pixels differ; ${rule} allows under ${limitPercent}%`;
	if (baselineShare === null) return limit;
	const where = stored ? `, in ${STORED_BASELINES_FILE} from a device that draws with both` : '';
	return `${limit}, and three.js's two renderers differ by ${percent(baselineShare)}${where}`;
}

// The parity command's switches.

export interface Comparison extends PagePair {
	/** How the command's report names the comparison: a GPU tier, or the two page kinds. */
	label: string;
	/** The GPU tier that a comparison of the tiers is on, which picks each feature scene's pair. */
	tier?: Tier;
}

/** True for the name of a benchmark scene, whose hold frames the benchmark pages draw. */
export function isBenchScene(name: string): name is BenchScene {
	return (BENCH_SCENES as readonly string[]).includes(name);
}

/** Every scene that the parity command can compare: the benchmark scenes, then the feature scenes. */
export const PARITY_SCENE_NAMES: readonly string[] = [
	...BENCH_SCENES,
	...FEATURE_SCENES.map((scene) => scene.test),
];

/** The scenes that the parity command compares when no `--scene` names others. */
export const DEFAULT_PARITY_SCENES: readonly string[] = [
	...PARITY_SCENES,
	...FEATURE_SCENES.map((scene) => scene.test),
];

export interface ParityOptions {
	/** The scenes to compare: benchmark scenes, and the image tests of feature scenes. */
	scenes: string[];
	comparisons: Comparison[];
	/** Save how much three.js's two renderers differ on each scene, for devices that lack one. */
	saveBaselines: boolean;
	/**
	 * Page switches that every benchmark scene's hold page gets, such as `shadows=3`, or an empty
	 * string. The feature scenes' pages take none.
	 */
	switches: string;
}

export const PARITY_USAGE =
	'usage: bun run parity [-- [--scene <scenes>] [--tier <tiers>] [--pair <page kind>,<page kind>] [--switches <switches>] [--save-baselines]]';

function readList<T extends string>(
	value: string | undefined,
	choices: readonly T[],
	what: string,
): T[] {
	const items = (value ?? '').split(',').filter(Boolean);
	if (items.length === 0)
		throw new Error(`name at least one ${what}: ${choices.join(', ')}\n${PARITY_USAGE}`);
	return [
		...new Set(
			items.map((item) => {
				const choice = choices.find((c) => c === item);
				if (choice === undefined)
					throw new Error(`"${item}" is not a ${what}. Use one of: ${choices.join(', ')}.`);
				return choice;
			}),
		),
	];
}

/**
 * Reads the parity command's switches. With no switch, it compares every scene of the parity checks,
 * the benchmark scenes and the feature scenes, on every GPU tier. `--scene` can name any benchmark
 * scene, to see how far one still differs, and any feature scene by its image test. `--pair a,b`
 * compares page kind a with page kind b instead, where b is the reference.
 */
export function parseParityArgs(args: readonly string[]): ParityOptions {
	let scenes: string[] = [...DEFAULT_PARITY_SCENES];
	let tiers: Tier[] | undefined;
	let pair: PageKind[] | undefined;
	let saveBaselines = false;
	let switches = '';
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') continue;
		if (arg === '--save-baselines') saveBaselines = true;
		else if (arg === '--switches') switches = readSwitches(args[++i], '--switches');
		else if (arg === '--scene') scenes = readList(args[++i], PARITY_SCENE_NAMES, 'scene');
		else if (arg === '--tier') tiers = readList(args[++i], TIERS, 'tier');
		else if (arg === '--pair') pair = readList(args[++i], PAGE_KINDS, 'page kind');
		else throw new Error(`unknown option ${arg}\n${PARITY_USAGE}`);
	}
	if (tiers && pair) throw new Error('use --tier or --pair, not both');
	if (saveBaselines && switches)
		throw new Error(
			'use --save-baselines without --switches: the baselines are of the plain scenes',
		);
	if (pair) {
		const [candidate, reference] = pair;
		if (pair.length !== 2 || !candidate || !reference)
			throw new Error(
				`--pair needs two different page kinds, such as threejs-webgl,threejs-webgpu`,
			);
		return {
			scenes,
			comparisons: [{ label: `${candidate} vs ${reference}`, candidate, reference }],
			saveBaselines,
			switches,
		};
	}
	return {
		scenes,
		comparisons: (tiers ?? [...TIERS]).map((tier) => ({ label: tier, tier, ...TIER_PAIRS[tier] })),
		saveBaselines,
		switches,
	};
}

// Frames and the rule.

const isPositiveInteger = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) > 0;

function checkImage(image: RgbaImage, what: string): void {
	const { width, height, data } = image;
	if (!isPositiveInteger(width) || !isPositiveInteger(height))
		throw new RangeError(`${what} has no valid size: ${width} x ${height}`);
	if (data.length !== width * height * BYTES_PER_PIXEL)
		throw new RangeError(
			`${what} holds ${data.length} bytes, not the ${width * height * BYTES_PER_PIXEL} that ${width} x ${height} RGBA8 pixels need`,
		);
}

/**
 * Reads the frame from a hold page's published result, `{ ok, scene, n, width, height, pixels }`,
 * whose pixels are RGBA8 rows in base64, top row first. It throws the page's own error when the
 * page failed, and an error that names the fault when the result is not a whole frame.
 */
export function decodeHoldResult(result: unknown): HoldFrame {
	const fields = succeededResult(result);
	const { scene, n } = fields;
	if (typeof scene !== 'string') throw new Error('the result does not name its scene');
	if (!Number.isSafeInteger(n) || (n as number) < 0)
		throw new Error(`the result has no valid object count: ${n}`);
	return frameOf(scene, n as number, fields);
}

/**
 * Reads the frame of a feature scene `scene` from a page's published result,
 * `{ ok, width, height, pixels }`: an image test page's or a twin's. The frame counts no objects,
 * because the two pages draw one scene module. It throws as `decodeHoldResult` does.
 */
export function decodeFeatureResult(result: unknown, scene: string): HoldFrame {
	return frameOf(scene, 0, succeededResult(result));
}

/** A published result's fields. It throws unless the result is an object of a page that succeeded. */
function succeededResult(result: unknown): Record<string, unknown> {
	if (typeof result !== 'object' || result === null)
		throw new Error('the page published no result object');
	const fields = result as Record<string, unknown>;
	if (fields.ok !== true)
		throw new Error(
			typeof fields.error === 'string' ? fields.error : 'the page failed without a message',
		);
	return fields;
}

/** The frame in a result's `width`, `height` and `pixels`. It throws unless they make a whole frame. */
function frameOf(
	scene: string,
	n: number,
	{ width, height, pixels }: Record<string, unknown>,
): HoldFrame {
	if (typeof pixels !== 'string') throw new Error('the result has no pixels');
	const frame = {
		scene,
		n,
		width: width as number,
		height: height as number,
		data: Buffer.from(pixels, 'base64'),
	};
	checkImage(frame, 'the frame');
	return frame;
}

/**
 * Compares two images with three.js's rule. The diff image dims the reference image and marks each
 * differing pixel in red. Images of different sizes are refused.
 */
export function compareImages(reference: RgbaImage, candidate: RgbaImage): ImageComparison {
	checkImage(reference, 'the reference image');
	checkImage(candidate, 'the candidate image');
	const { width, height } = reference;
	if (candidate.width !== width || candidate.height !== height) {
		throw new RangeError(
			`the images differ in size: ${width} x ${height} and ${candidate.width} x ${candidate.height}`,
		);
	}
	const a = reference.data;
	const b = candidate.data;
	const diff = new Uint8Array(a.length);
	const thresholdSquared = PIXEL_THRESHOLD * PIXEL_THRESHOLD;
	let differentPixels = 0;
	for (let i = 0; i < a.length; i += BYTES_PER_PIXEL) {
		const red = a[i] ?? 0;
		const green = a[i + 1] ?? 0;
		const blue = a[i + 2] ?? 0;
		const dr = red - (b[i] ?? 0);
		const dg = green - (b[i + 1] ?? 0);
		const db = blue - (b[i + 2] ?? 0);
		if ((dr * dr + dg * dg + db * db) / MAX_SQUARED_DISTANCE > thresholdSquared) {
			differentPixels++;
			diff[i] = 255;
		} else {
			diff[i] = red * DIFF_DIM;
			diff[i + 1] = green * DIFF_DIM;
			diff[i + 2] = blue * DIFF_DIM;
		}
		diff[i + 3] = OPAQUE;
	}
	const share = differentPixels / (width * height);
	return {
		differentPixels,
		share,
		pass: share * 100 < MAX_DIFFERENT_PERCENT,
		diff: { width, height, data: diff },
	};
}

/**
 * Compares a candidate page's hold frame with a reference page's frame. Frames of different scenes
 * or object counts are refused, because their difference would say nothing about the engines.
 */
export function compareFrames(candidate: HoldFrame, reference: HoldFrame): ImageComparison {
	if (candidate.scene !== reference.scene)
		throw new Error(`the pages drew different scenes: ${candidate.scene} and ${reference.scene}`);
	if (candidate.n !== reference.n)
		throw new Error(`the pages drew different object counts: ${candidate.n} and ${reference.n}`);
	return compareImages(reference, candidate);
}

function sideBySide(left: RgbaImage, right: RgbaImage): RgbaImage {
	if (left.height !== right.height)
		throw new RangeError(`the images differ in height: ${left.height} and ${right.height}`);
	const { height } = left;
	const width = left.width + right.width;
	const leftRow = left.width * BYTES_PER_PIXEL;
	const rightRow = right.width * BYTES_PER_PIXEL;
	const data = new Uint8Array(width * height * BYTES_PER_PIXEL);
	for (let y = 0; y < height; y++) {
		const row = y * width * BYTES_PER_PIXEL;
		data.set(left.data.subarray(y * leftRow, (y + 1) * leftRow), row);
		data.set(right.data.subarray(y * rightRow, (y + 1) * rightRow), row + leftRow);
	}
	return { width, height, data };
}

/**
 * The PNG files that a comparison saves, each with its file name: the two frames side by side with
 * the candidate on the left, and the diff image.
 */
export function parityFiles(
	name: string,
	candidate: RgbaImage,
	reference: RgbaImage,
	diff: RgbaImage,
): { file: string; png: Uint8Array }[] {
	return [
		{ file: `${name}-inputs.png`, png: encodePng(sideBySide(candidate, reference)) },
		{ file: `${name}-diff.png`, png: encodePng(diff) },
	];
}
