// Parity images: hold frames of the benchmark scenes from two kinds of benchmark page, compared
// with three.js's own image rule. Everything here is pure. The parity command (bench/parity.ts) and
// the runner's parity plan (tests/lib/plans.ts) load the pages and write the files.
//
// The rule is the one that three.js's end-to-end test applies to its example screenshots
// (test/e2e/puppeteer.js and test/e2e/image.js in the three.js repository, at the release that the
// benchmark pages use). A pixel differs when the distance between its two RGB colors is more than a
// set share of the distance from black to white. Alpha does not count, and no pixel is excused as
// anti-aliasing. Two images match when strictly less than a set percentage of their pixels differ.
import { encode } from 'fast-png';

/** A pixel differs when its RGB distance is more than this share of the distance from black to white. */
export const PIXEL_THRESHOLD = 0.1;
/** Two images match when strictly less than this percentage of their pixels differ. */
export const MAX_DIFFERENT_PERCENT = 0.1;

/** The squared RGB distance from black to white, which scales a squared distance to [0, 1]. */
const MAX_SQUARED_DISTANCE = 255 * 255 * 3;
/** A diff image shows each matching pixel at this share of the reference pixel's value. */
const DIFF_DIM = 0.2;
const BYTES_PER_PIXEL = 4;
const OPAQUE = 255;

/** RGBA8 pixels, rows tightly packed, top row first. */
export interface RgbaImage {
	width: number;
	height: number;
	data: Uint8Array;
}

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

export const PARITY_SCENES = ['s1', 's1-static', 's2'] as const;
export type ParityScene = (typeof PARITY_SCENES)[number];

export const TIERS = ['webgpu', 'webgl2'] as const;
export type Tier = (typeof TIERS)[number];

/** Each kind of benchmark page: its folder, and the switch that picks its GPU path. */
const PAGES = {
	'threejs-webgl': { folder: 'threejs', gpu: 'renderer=webgl' },
	'threejs-webgpu': { folder: 'threejs', gpu: 'renderer=webgpu' },
	'null3d-webgl2': { folder: 'null3d', gpu: 'gpu=webgl2' },
	'null3d-webgpu': { folder: 'null3d', gpu: 'gpu=webgpu' },
} as const satisfies Record<string, { folder: string; gpu: string }>;

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

/** Two pages whose frames must match. The diff image dims the reference's frame. */
export interface PagePair {
	candidate: PageKind;
	reference: PageKind;
}

/** On each GPU tier, the null3d page and the three.js page that it must match. */
export const TIER_PAIRS: Readonly<Record<Tier, PagePair>> = {
	webgpu: { candidate: 'null3d-webgpu', reference: 'threejs-webgpu' },
	webgl2: { candidate: 'null3d-webgl2', reference: 'threejs-webgl' },
};

/** The dev-server path of one scene's page of one kind, with more switches after its own. */
export function pagePath(scene: ParityScene, kind: BenchPageKind, switches = ''): string {
	const page = kind === SCENE_CODE ? { folder: SCENE_CODE, gpu: '' } : PAGES[kind];
	return `/bench/pages/${page.folder}/${scene}.html?${[page.gpu, switches].filter(Boolean).join('&')}`;
}

/** The dev-server path of the page that draws one scene's hold frame. */
export function holdPagePath(scene: ParityScene, kind: PageKind): string {
	return pagePath(scene, kind, 'hold');
}

/** The name that a comparison's image files start with. */
export function comparisonName(scene: ParityScene, { candidate, reference }: PagePair): string {
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
export type StoredBaselines = Partial<Record<ParityScene, number>>;

/** The stored baselines in a file's text; unknown scenes and values that are not a share drop out. */
export function parseStoredBaselines(text: string): StoredBaselines {
	const scenes = (JSON.parse(text) as { scenes?: Record<string, unknown> }).scenes ?? {};
	const baselines: StoredBaselines = {};
	for (const scene of PARITY_SCENES) {
		const share = scenes[scene];
		if (typeof share === 'number' && share >= 0 && share <= 1) baselines[scene] = share;
	}
	return baselines;
}

/** The file's text for stored baselines, in scene order. */
export function formatStoredBaselines(baselines: StoredBaselines): string {
	const scenes: StoredBaselines = {};
	for (const scene of PARITY_SCENES) {
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
export function passesWithBaseline(share: number, baselineShare: number | null): boolean {
	return share * 100 < MAX_DIFFERENT_PERCENT || (baselineShare !== null && share <= baselineShare);
}

const percent = (share: number) => `${(share * 100).toFixed(3)}%`;

/**
 * How much two images differ, and what may differ, in words for a report. A `stored` baseline was
 * measured on another device, because this one cannot draw with both of three.js's renderers.
 */
export function differenceText(
	{ share }: Pick<ImageComparison, 'share'>,
	baselineShare: number | null = null,
	stored = false,
): string {
	const limit = `${percent(share)} of pixels differ; three.js's rule allows under ${MAX_DIFFERENT_PERCENT}%`;
	if (baselineShare === null) return limit;
	const where = stored ? `, in ${STORED_BASELINES_FILE} from a device that draws with both` : '';
	return `${limit}, and three.js's two renderers differ by ${percent(baselineShare)}${where}`;
}

// The parity command's switches.

export interface Comparison extends PagePair {
	/** How the command's report names the comparison: a GPU tier, or the two page kinds. */
	label: string;
}

export interface ParityOptions {
	scenes: ParityScene[];
	comparisons: Comparison[];
	/** Save how much three.js's two renderers differ on each scene, for devices that lack one. */
	saveBaselines: boolean;
}

export const PARITY_USAGE =
	'usage: bun run parity [-- [--scene <scenes>] [--tier <tiers>] [--pair <page kind>,<page kind>] [--save-baselines]]';

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
 * Reads the parity command's switches. With no switch, it compares every scene on both GPU tiers.
 * `--pair a,b` compares page kind a with page kind b instead, where b is the reference.
 */
export function parseParityArgs(args: readonly string[]): ParityOptions {
	let scenes: ParityScene[] = [...PARITY_SCENES];
	let tiers: Tier[] | undefined;
	let pair: PageKind[] | undefined;
	let saveBaselines = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') continue;
		if (arg === '--save-baselines') saveBaselines = true;
		else if (arg === '--scene') scenes = readList(args[++i], PARITY_SCENES, 'scene');
		else if (arg === '--tier') tiers = readList(args[++i], TIERS, 'tier');
		else if (arg === '--pair') pair = readList(args[++i], PAGE_KINDS, 'page kind');
		else throw new Error(`unknown option ${arg}\n${PARITY_USAGE}`);
	}
	if (tiers && pair) throw new Error('use --tier or --pair, not both');
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
		};
	}
	return {
		scenes,
		comparisons: (tiers ?? [...TIERS]).map((tier) => ({ label: tier, ...TIER_PAIRS[tier] })),
		saveBaselines,
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
	if (typeof result !== 'object' || result === null)
		throw new Error('the page published no result object');
	const { ok, error, scene, n, width, height, pixels } = result as Record<string, unknown>;
	if (ok !== true)
		throw new Error(typeof error === 'string' ? error : 'the page failed without a message');
	if (typeof scene !== 'string') throw new Error('the result does not name its scene');
	if (!Number.isSafeInteger(n) || (n as number) < 0)
		throw new Error(`the result has no valid object count: ${n}`);
	if (typeof pixels !== 'string') throw new Error('the result has no pixels');
	const frame = {
		scene,
		n: n as number,
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

function encodePng({ width, height, data }: RgbaImage): Uint8Array {
	return encode({ width, height, data, channels: 4, depth: 8 });
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
