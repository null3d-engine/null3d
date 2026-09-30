// Feature scenes against their three.js twins. On each GPU tier, null3D's image of a feature scene,
// as the image test manifest draws it, must match the image of the scene's three.js twin by
// three.js's own rule, or at least as closely as three.js's two renderers match each other. Each
// comparison saves both images side by side, and its diff, under test-results/parity/. The twins
// load from the production build of the benchmark pages; null3D's side loads from the dev server,
// because the image test page loads its sketch by address.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { manifestRun } from '../../tests/image/manifest.ts';
import { HTTP_PORT } from '../../tests/lib/server.ts';
import {
	compareImages,
	differenceText,
	gpuApiOf,
	parityFiles,
	passesWithBaseline,
	type RgbaImage,
	TIERS,
} from '../lib/parity';
import { type PageReport, runPage } from './open-page';

/** Each feature scene: the manifest's image test that draws it, and its three.js twin page. */
const FEATURE_SCENES = [
	{ test: 'ortho-camera', twin: '/bench/pages/threejs/ortho-camera.html' },
] as const;

const OUTPUT_DIR = join(import.meta.dirname, '../../test-results/parity');
/** The dev server, which serves the image test pages. */
const DEV_SERVER_URL = `http://localhost:${HTTP_PORT}`;

type Renderer = 'webgl' | 'webgpu';

/** What a page that draws an image publishes: RGBA8 rows in base64, top row first. */
interface ImageReport extends PageReport {
	width: number;
	height: number;
	pixels: string;
}

/** Opens a page and returns the image it publishes. It fails on a page error or a console error. */
async function imageOf(page: Page, path: string): Promise<RgbaImage> {
	const { width, height, pixels } = await runPage<ImageReport>(page, path);
	return { width, height, data: Buffer.from(pixels, 'base64') };
}

for (const { test: name, twin } of FEATURE_SCENES) {
	test.describe(`${name} against three.js`, () => {
		const threeImages = new Map<Renderer, RgbaImage>();
		/** How much three.js's two renderers differ on the scene, as a share of its pixels. */
		let baseline = 0;

		test.beforeAll(async ({ browser }) => {
			for (const renderer of ['webgl', 'webgpu'] as const) {
				const page = await browser.newPage();
				threeImages.set(renderer, await imageOf(page, `${twin}?renderer=${renderer}`));
				await page.close();
			}
			const [webgl, webgpu] = [threeImages.get('webgl'), threeImages.get('webgpu')];
			if (!webgl || !webgpu) throw new Error(`${twin} published no image`);
			baseline = compareImages(webgpu, webgl).share;
		});

		for (const tier of TIERS) {
			test(`matches three.js on ${tier}`, async ({ page }) => {
				const renderer: Renderer = gpuApiOf(tier) === 'webgl2' ? 'webgl' : 'webgpu';
				const reference = threeImages.get(renderer) as RgbaImage;
				const run = manifestRun(name, tier, 'pipelined');
				const candidate = await imageOf(page, DEV_SERVER_URL + run.path);
				const comparison = compareImages(reference, candidate);
				const files = parityFiles(
					`${name}-null3d-${tier}-vs-threejs-${renderer}`,
					candidate,
					reference,
					comparison.diff,
				);
				mkdirSync(OUTPUT_DIR, { recursive: true });
				for (const { file, png } of files) writeFileSync(join(OUTPUT_DIR, file), png);
				const images = files.map(({ file }) => `test-results/parity/${file}`).join(', ');
				const difference = differenceText(comparison, baseline);
				console.log(`${name} on ${tier}: ${difference}`);
				expect(
					passesWithBaseline(comparison.share, baseline),
					`${difference}. Images: ${images}`,
				).toBe(true);
			});
		}
	});
}
