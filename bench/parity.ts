// Compares null3D's frames with three.js's: the hold frames of the benchmark scenes, and the
// feature scenes, each an image test of the manifest beside its three.js twin page. On each GPU
// tier, the null3d page must match the three.js page by three.js's own image rule, or at least as
// closely as three.js's two renderers match each other on the same frame. A scene with a limit of
// its own, such as the shadows, passes under that limit instead. It opens the pages in the browser
// tests' environment through Playwright: Chrome on the Mac's GPU, or SwiftShader with CI=1. It
// compares the two frames, and saves them side by side with a diff image under
// test-results/parity/. It prints one line per scene and comparison, and exits with 1 when any
// comparison fails. From the repository root:
//   bun run parity
//   bun run parity -- --tier webgpu,webgl2
//   bun run parity -- --scene s1,s2,shadows --tier webgpu
//   bun run parity -- --pair threejs-webgl,threejs-webgpu
//   bun run parity -- --scene s2 --tier webgpu --switches shadows=3
//   bun run parity -- --save-baselines
// Options:
//   --scene <list>   benchmark scenes: s1, s1-static, s1-cells, s2, s3, s4, and feature scenes by
//                    their image tests (FEATURE_SCENES in bench/lib/parity.ts). The default is
//                    every feature scene and every benchmark scene that both engines draw in full
//                    (PARITY_SCENES)
//   --tier <list>    GPU tiers: webgpu, compat (WebGPU forced into compatibility mode), webgl2;
//                    the default is all three
//   --pair <a>,<b>   compare page kind a with page kind b, the reference, instead of the tiers.
//                    Page kinds: threejs-webgl, threejs-webgpu, null3d-webgl2, null3d-webgpu,
//                    null3d-compat
//   --switches <q>   page switches that every benchmark scene's hold page gets, such as
//                    shadows=3: S2 with the sun's shadows
//   --save-baselines save how much three.js's two renderers differ on each benchmark scene in
//                    bench/parity-baselines.json, where the device runner reads it for devices
//                    that cannot draw with both
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Browser, errors } from '@playwright/test';
import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';
import { watchConsole } from '../packages/cli/src/page.js';
import { featureImagePath } from '../tests/image/manifest.ts';
import { pageResult } from '../tests/lib/page-result.ts';
import { REPO_ROOT, startServer } from '../tests/lib/server.ts';
import {
	BASELINE_PAIR,
	type Comparison,
	compareFrames,
	comparisonName,
	decodeFeatureResult,
	decodeHoldResult,
	differenceText,
	featurePagePath,
	featurePair,
	featureScene,
	formatStoredBaselines,
	type HoldFrame,
	holdPagePath,
	type ImageComparison,
	isBenchScene,
	MAX_DIFFERENT_PERCENT,
	type PageKind,
	type PagePair,
	parityFiles,
	parseParityArgs,
	parseStoredBaselines,
	passesWithBaseline,
	STORED_BASELINES_FILE,
	type StoredBaselines,
} from './lib/parity';

const OUTPUT_DIR = join(REPO_ROOT, 'test-results/parity');
/** How long a page may take to publish its frame. */
const RESULT_TIMEOUT_MS = 90_000;

/**
 * How the command draws one scene: the page of each kind, or null for a kind that cannot draw it;
 * how it reads a page's result; the pages that each comparison compares; its limit; and whether
 * three.js's two renderers both draw it, for the baseline.
 */
interface SceneSource {
	name: string;
	path(kind: PageKind): string | null;
	decode(result: unknown): HoldFrame;
	pair(comparison: Comparison): PagePair;
	limit: number;
	baseline: boolean;
}

/** How the command draws a benchmark scene or a feature scene. */
function sourceOf(name: string, switches: string): SceneSource {
	if (isBenchScene(name))
		return {
			name,
			path: (kind) => holdPagePath(name, kind, switches),
			decode: decodeHoldResult,
			pair: (comparison) => comparison,
			limit: MAX_DIFFERENT_PERCENT,
			baseline: true,
		};
	const scene = featureScene(name);
	if (!scene) throw new Error(`no page draws the scene ${name}`);
	return {
		name,
		path: (kind) => featurePagePath(scene, kind, (tier) => featureImagePath(scene, tier)),
		decode: (result) => decodeFeatureResult(result, name),
		pair: (comparison) =>
			comparison.tier === undefined ? comparison : featurePair(scene, comparison.tier),
		limit: scene.limit ?? MAX_DIFFERENT_PERCENT,
		baseline: scene.webglOnly !== true,
	};
}

/**
 * Opens the page of one kind that draws a scene, and reads its frame. A failure comes back as a
 * message that names the page kind, never as a throw: a kind that cannot draw the scene, a missing
 * page, a page error, a timeout, or a result without a frame.
 */
async function loadFrame(
	browser: Browser,
	baseUrl: string,
	source: SceneSource,
	kind: PageKind,
): Promise<HoldFrame | string> {
	const path = source.path(kind);
	if (path === null) return `${kind}: no page of this kind draws ${source.name}`;
	const page = await browser.newPage();
	const { errors: pageErrors } = watchConsole(page);
	try {
		const response = await page.goto(`${baseUrl}${path}`);
		if (response?.status() === 404) return `${kind}: page not found at ${path}`;
		if (response && !response.ok())
			return `${kind}: the dev server answered HTTP ${response.status()} for ${path}`;
		return source.decode(await pageResult(page, RESULT_TIMEOUT_MS));
	} catch (e) {
		const reason =
			e instanceof errors.TimeoutError
				? `no result within ${RESULT_TIMEOUT_MS / 1000} s`
				: (e as Error).message;
		const logged = pageErrors.length > 0 ? ` (page errors: ${pageErrors.join('; ')})` : '';
		return `${kind}: ${reason}${logged}`;
	} finally {
		await page.close();
	}
}

/** Compares the frames of one comparison for one scene, and reports in one line. */
function runComparison(
	source: SceneSource,
	comparison: Comparison,
	pair: PagePair,
	candidate: HoldFrame | string,
	reference: HoldFrame | string,
	baselineShare: number | null,
): { pass: boolean; line: string } {
	const label = `${source.name} ${comparison.label}`;
	if (typeof candidate === 'string' || typeof reference === 'string') {
		const problems = [candidate, reference].filter((frame) => typeof frame === 'string');
		return { pass: false, line: `FAIL  ${label}: ${problems.join('; ')}` };
	}
	let result: ImageComparison;
	try {
		result = compareFrames(candidate, reference);
	} catch (e) {
		return { pass: false, line: `FAIL  ${label}: ${(e as Error).message}` };
	}
	const files = parityFiles(comparisonName(source.name, pair), candidate, reference, result.diff);
	for (const { file, png } of files) writeFileSync(join(OUTPUT_DIR, file), png);
	const images = files.map(({ file }) => relative(REPO_ROOT, join(OUTPUT_DIR, file))).join(', ');
	const pass = passesWithBaseline(result.share, baselineShare, source.limit);
	const difference = differenceText(result, baselineShare, false, source.limit);
	return { pass, line: `${pass ? 'pass' : 'FAIL'}  ${label}: ${difference}. Images: ${images}` };
}

/**
 * Keeps the measured baselines for devices that cannot draw with both of three.js's renderers,
 * next to the ones stored for scenes this run did not measure.
 */
function saveBaselines(measured: StoredBaselines): void {
	const path = join(REPO_ROOT, STORED_BASELINES_FILE);
	const stored = existsSync(path) ? parseStoredBaselines(readFileSync(path, 'utf8')) : {};
	writeFileSync(path, formatStoredBaselines({ ...stored, ...measured }));
	const scenes = Object.keys(measured);
	console.log(
		scenes.length > 0
			? `saved the baselines of ${scenes.join(', ')} in ${STORED_BASELINES_FILE}.`
			: 'no baseline was measured, so none was saved.',
	);
}

async function main(): Promise<void> {
	const options = parseParityArgs(process.argv.slice(2));
	// Each run starts with an empty folder, so no image from an earlier run can pass for this one.
	rmSync(OUTPUT_DIR, { recursive: true, force: true });
	mkdirSync(OUTPUT_DIR, { recursive: true });
	const server = await startServer();
	let passed = 0;
	let total = 0;
	const measured: StoredBaselines = {};
	try {
		const browser = await launchBrowser(defaultEnvironment());
		try {
			for (const scene of options.scenes) {
				const source = sourceOf(scene, options.switches);
				// Each page loads once per scene, however many comparisons use its frame.
				const frames = new Map<PageKind, HoldFrame | string>();
				const frameOf = async (kind: PageKind) => {
					if (!frames.has(kind))
						frames.set(kind, await loadFrame(browser, server.url, source, kind));
					return frames.get(kind) as HoldFrame | string;
				};
				let baseline: number | null | undefined;
				const baselineShare = async () => {
					if (baseline === undefined) {
						const webgl = source.baseline ? await frameOf(BASELINE_PAIR.candidate) : null;
						const webgpu = source.baseline ? await frameOf(BASELINE_PAIR.reference) : null;
						baseline =
							webgl === null ||
							webgpu === null ||
							typeof webgl === 'string' ||
							typeof webgpu === 'string'
								? null
								: compareFrames(webgl, webgpu).share;
						if (baseline !== null && isBenchScene(scene)) measured[scene] = baseline;
					}
					return baseline;
				};
				if (options.saveBaselines && isBenchScene(scene)) await baselineShare();
				for (const comparison of options.comparisons) {
					const pair = source.pair(comparison);
					const engines = pair.candidate.startsWith('null3d');
					const { pass, line } = runComparison(
						source,
						comparison,
						pair,
						await frameOf(pair.candidate),
						await frameOf(pair.reference),
						engines ? await baselineShare() : null,
					);
					console.log(line);
					total++;
					if (pass) passed++;
				}
			}
		} finally {
			await browser.close();
		}
	} finally {
		server.stop();
	}
	console.log(`${passed} of ${total} comparisons pass.`);
	if (options.saveBaselines) saveBaselines(measured);
	process.exit(passed === total ? 0 : 1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
