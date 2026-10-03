// Feature scenes against their three.js twins, as `bun run parity` compares them, on SwiftShader in
// CI. On each GPU tier, null3D's image of a feature scene, as the image test manifest draws it,
// must match the image of the scene's three.js twin by three.js's own rule, or at least as closely
// as three.js's two renderers match each other. A scene with a limit of its own, such as the
// shadows, passes under that limit instead. Each comparison saves both images side by side, and
// its diff, under test-results/parity/. The twins load from the production build of the benchmark
// pages; null3D's side loads from the dev server, because the image test page loads its sketch by
// address.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { featureImagePath } from '../../tests/image/manifest.ts';
import { HTTP_PORT } from '../../tests/lib/server.ts';
import {
	BASELINE_PAIR,
	compareImages,
	comparisonName,
	differenceText,
	FEATURE_SCENES,
	type FeatureScene,
	featurePagePath,
	featurePair,
	featureTiers,
	type PageKind,
	parityFiles,
	passesWithBaseline,
	type RgbaImage,
} from '../lib/parity';
import { type PageReport, runPage } from './open-page';

const OUTPUT_DIR = join(import.meta.dirname, '../../test-results/parity');
/** The dev server, which serves the image test pages. */
const DEV_SERVER_URL = `http://localhost:${HTTP_PORT}`;

/** What a page that draws an image publishes: RGBA8 rows in base64, top row first. */
interface ImageReport extends PageReport {
	width: number;
	height: number;
	pixels: string;
}

/** The path of a scene's page of one kind: the twin's in the build, or null3D's on the dev server. */
function pathOf(scene: FeatureScene, kind: PageKind): string {
	const path = featurePagePath(scene, kind, (tier) => featureImagePath(scene, tier));
	if (path === null) throw new Error(`no page of kind ${kind} draws ${scene.test}`);
	return kind.startsWith('null3d') ? DEV_SERVER_URL + path : path;
}

/** Opens a page and returns the image it publishes. It fails on a page error or a console error. */
async function imageOf(page: Page, path: string): Promise<RgbaImage> {
	const { width, height, pixels } = await runPage<ImageReport>(page, path);
	return { width, height, data: Buffer.from(pixels, 'base64') };
}

for (const scene of FEATURE_SCENES) {
	const { test: name, limit, webglOnly } = scene;
	test.describe(`${name} against three.js`, () => {
		const twinImages = new Map<PageKind, RgbaImage>();
		/** How much three.js's two renderers differ on the scene, as a share of its pixels. */
		let baseline: number | null = null;

		test.beforeAll(async ({ browser }) => {
			const kinds = webglOnly ? [BASELINE_PAIR.candidate] : Object.values(BASELINE_PAIR);
			for (const kind of kinds) {
				const page = await browser.newPage();
				twinImages.set(kind, await imageOf(page, pathOf(scene, kind)));
				await page.close();
			}
			const webgl = twinImages.get(BASELINE_PAIR.candidate);
			const webgpu = twinImages.get(BASELINE_PAIR.reference);
			if (webgl && webgpu) baseline = compareImages(webgpu, webgl).share;
		});

		for (const tier of featureTiers(scene)) {
			test(`matches three.js on ${tier}`, async ({ page }) => {
				const pair = featurePair(scene, tier);
				const reference = twinImages.get(pair.reference) as RgbaImage;
				const candidate = await imageOf(page, pathOf(scene, pair.candidate));
				const comparison = compareImages(reference, candidate);
				const files = parityFiles(
					comparisonName(name, pair),
					candidate,
					reference,
					comparison.diff,
				);
				mkdirSync(OUTPUT_DIR, { recursive: true });
				for (const { file, png } of files) writeFileSync(join(OUTPUT_DIR, file), png);
				const images = files.map(({ file }) => `test-results/parity/${file}`).join(', ');
				const difference = differenceText(comparison, baseline, false, limit);
				console.log(`${name} on ${tier}: ${difference}`);
				expect(
					passesWithBaseline(comparison.share, baseline, limit),
					`${difference}. Images: ${images}`,
				).toBe(true);
			});
		}
	});
}
