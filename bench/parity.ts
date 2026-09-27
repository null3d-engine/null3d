// Compares the hold frames of the benchmark scenes between engines. On each GPU tier, the sokko3d
// page must match the three.js page by three.js's own image rule, or at least as closely as
// three.js's two renderers match each other on the same frame. It opens the hold pages in
// Chrome through Playwright, with the browser tests' launch options, compares the two frames, and
// saves them side by side with a diff image under test-results/parity/. It prints one line per
// scene and comparison, and exits with 1 when any comparison fails. From the repository root:
//   bun run parity
//   bun run parity -- --scene s1,s2 --tier webgpu
//   bun run parity -- --pair threejs-webgl,threejs-webgpu
// Options:
//   --scene <list>   scenes: s1, s1-static, s2; the default is all three
//   --tier <list>    GPU tiers: webgpu, webgl2; the default is both
//   --pair <a>,<b>   compare page kind a with page kind b, the reference, instead of the tiers.
//                    Page kinds: threejs-webgl, threejs-webgpu, sokko3d-webgl2, sokko3d-webgpu
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Browser, chromium, errors } from '@playwright/test';
import { REPO_ROOT, startServer } from '../tests/lib/server.ts';
import browserTests from '../tests/playwright.config.ts';
import {
	BASELINE_PAIR,
	type Comparison,
	compareFrames,
	comparisonName,
	decodeHoldResult,
	differenceText,
	type HoldFrame,
	holdPagePath,
	type ImageComparison,
	type PageKind,
	type ParityScene,
	parityFiles,
	parseParityArgs,
	passesWithBaseline,
} from './lib/parity';

const OUTPUT_DIR = join(REPO_ROOT, 'test-results/parity');
/** How long a page may take to publish its frame. */
const RESULT_TIMEOUT_MS = 90_000;

/** Runs in the page: the result the page published, once it exists. */
const readResult = () => (globalThis as { __sokko3dResult?: unknown }).__sokko3dResult;

/**
 * Opens a hold page and reads its frame. A failure comes back as a message that names the page
 * kind, never as a throw: a missing page, a page error, a timeout, or a result without a frame.
 */
async function loadFrame(
	browser: Browser,
	baseUrl: string,
	scene: ParityScene,
	kind: PageKind,
): Promise<HoldFrame | string> {
	const path = holdPagePath(scene, kind);
	const page = await browser.newPage();
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') pageErrors.push(message.text());
	});
	try {
		const response = await page.goto(`${baseUrl}${path}`);
		if (response?.status() === 404) return `${kind}: page not found at ${path}`;
		if (response && !response.ok())
			return `${kind}: the dev server answered HTTP ${response.status()} for ${path}`;
		const handle = await page.waitForFunction(readResult, undefined, {
			timeout: RESULT_TIMEOUT_MS,
		});
		return decodeHoldResult(await handle.jsonValue());
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
	scene: ParityScene,
	comparison: Comparison,
	candidate: HoldFrame | string,
	reference: HoldFrame | string,
	baselineShare: number | null,
): { pass: boolean; line: string } {
	const label = `${scene} ${comparison.label}`;
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
	const files = parityFiles(comparisonName(scene, comparison), candidate, reference, result.diff);
	for (const { file, png } of files) writeFileSync(join(OUTPUT_DIR, file), png);
	const images = files.map(({ file }) => relative(REPO_ROOT, join(OUTPUT_DIR, file))).join(', ');
	const pass = passesWithBaseline(result.share, baselineShare);
	return {
		pass,
		line: `${pass ? 'pass' : 'FAIL'}  ${label}: ${differenceText(result, baselineShare)}. Images: ${images}`,
	};
}

async function main(): Promise<void> {
	const options = parseParityArgs(process.argv.slice(2));
	// Each run starts with an empty folder, so no image from an earlier run can pass for this one.
	rmSync(OUTPUT_DIR, { recursive: true, force: true });
	mkdirSync(OUTPUT_DIR, { recursive: true });
	const server = await startServer();
	const { headless, channel, launchOptions } = browserTests.use ?? {};
	let passed = 0;
	let total = 0;
	try {
		const browser = await chromium.launch({ ...launchOptions, headless, channel });
		try {
			for (const scene of options.scenes) {
				// Each page loads once per scene, however many comparisons use its frame.
				const frames = new Map<PageKind, HoldFrame | string>();
				const frameOf = async (kind: PageKind) => {
					if (!frames.has(kind))
						frames.set(kind, await loadFrame(browser, server.url, scene, kind));
					return frames.get(kind) as HoldFrame | string;
				};
				let baseline: number | null | undefined;
				const baselineShare = async () => {
					if (baseline === undefined) {
						const webgl = await frameOf(BASELINE_PAIR.candidate);
						const webgpu = await frameOf(BASELINE_PAIR.reference);
						baseline =
							typeof webgl === 'string' || typeof webgpu === 'string'
								? null
								: compareFrames(webgl, webgpu).share;
					}
					return baseline;
				};
				for (const comparison of options.comparisons) {
					const engines = comparison.candidate.startsWith('sokko3d');
					const { pass, line } = runComparison(
						scene,
						comparison,
						await frameOf(comparison.candidate),
						await frameOf(comparison.reference),
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
	process.exit(passed === total ? 0 : 1);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
