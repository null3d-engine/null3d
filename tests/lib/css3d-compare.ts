// The reading of a port of one of three.js's CSS3D examples (tests/pages/lib/css3d-example.ts). The
// page draws its scene twice, by null3D and by three.js's CSS3DRenderer, and publishes each
// element's box. This module loads the page on each GPU path, checks that both stages drew their
// elements, hides both canvases, and compares the pixels of the two layers of elements.
//
// The comparison reads the page's own element pixels, which no GPU draws, so a screenshot is the
// reading, as it is for the CSS3D periodic table. The engine's own pixels are checked separately by
// the page, which reports them for a port whose scene has WebGL content.
import { expect, type Page } from '@playwright/test';
import { compareImages, percent } from '../../packages/cli/src/compare.js';
import { decodePngRgba } from '../../packages/cli/src/png.js';
import { pageResult } from './page-result.ts';

/**
 * The most of the picture that may differ: a thousandth, the limit of the reference images. Both
 * stages are the same DOM in the same browser, so the allowance is for a slower rasteriser, not for
 * placement, which comes from the same matrices.
 */
const MAX_DIFFERENCE = 0.001;

/** The GPU paths that every port draws on. */
export const GPU_PATHS = ['webgpu', 'webgl2'] as const;

/** What a port's page publishes. */
export interface PortResult {
	ok: boolean;
	error?: string;
	stage: { width: number; height: number };
	/** The elements that each stage shows. */
	mine: number;
	theirs: number;
	/** Each element's x, y, width and height in CSS pixels, in the port's order. */
	boxes: { mine: number[][]; theirs: number[][] };
	/** Whether the engine shows each of its elements. */
	shown: { mine: boolean[] };
	/** The pixels that the engine drew, for a port whose scene has WebGL content. */
	webglPixels: number;
	mode: { hold: number | null };
}

/** How far an element's box may sit from three.js's, in CSS pixels. */
const BOX_TOLERANCE = 1.5;

/**
 * Loads a port at one GPU path and compares its elements with three.js's own draw. Returns the
 * page's result, so a test can assert on the scene it drew.
 */
export async function expectSameElements(
	page: Page,
	name: string,
	gpu: string,
): Promise<PortResult> {
	await page.goto(`${name}.html?gpu=${gpu}`);
	const result = await pageResult<PortResult>(page, 60_000);
	expect(result.error, 'the page failed').toBeUndefined();
	expect(result.mine, 'the elements that each stage shows').toBe(result.theirs);
	expect([result.stage.width, result.stage.height]).toEqual([960, 540]);

	// Each element that the engine shows sits where three.js puts it, within the tolerance of a
	// composed box. An element behind the camera shows in neither stage.
	let shown = 0;
	for (let index = 0; index < result.mine; index++) {
		if (!result.shown.mine[index]) continue;
		shown++;
		const mine = result.boxes.mine[index] as number[];
		const theirs = result.boxes.theirs[index] as number[];
		expect(mine[2] as number, `element ${index}'s width`).toBeGreaterThan(0);
		for (let k = 0; k < 4; k++)
			expect(
				Math.abs((mine[k] as number) - (theirs[k] as number)),
				`element ${index}'s ${['x', 'y', 'width', 'height'][k]} against three.js's`,
			).toBeLessThanOrEqual(BOX_TOLERANCE);
	}
	expect(shown, 'elements that the engine shows').toBeGreaterThan(0);

	// Hide both canvases, so the screenshots hold the elements and the stage's background alone.
	// The engine's own pixels are a separate reading, which the page reports.
	await page.evaluate(async () => {
		const globals = globalThis as unknown as {
			document: {
				querySelectorAll(selector: string): { style: { visibility: string } }[];
			};
			requestAnimationFrame(callback: () => void): number;
		};
		for (const canvas of globals.document.querySelectorAll('canvas'))
			canvas.style.visibility = 'hidden';
		await new Promise<void>((resolve) => {
			globals.requestAnimationFrame(() => globals.requestAnimationFrame(() => resolve()));
		});
	});
	const mine = decodePngRgba(
		Buffer.from(await page.locator('#mine-labels').screenshot()),
		'null3D',
	);
	const theirs = decodePngRgba(
		Buffer.from(await page.locator('#theirs-labels').screenshot()),
		'three.js',
	);
	expect([mine.width, mine.height]).toEqual([result.stage.width, result.stage.height]);
	expect([theirs.width, theirs.height]).toEqual([result.stage.width, result.stage.height]);
	const { share } = compareImages(theirs, mine, 0.1);
	// The figure goes into the run's log, so the record of a port can state it and not only its pass.
	console.log(`${name} at ${gpu}: ${percent(share)} of the pixels differ from three.js's draw`);
	expect(
		share,
		`${percent(share)} of the pixels differ from three.js's draw at ${gpu}`,
	).toBeLessThanOrEqual(MAX_DIFFERENCE);
	return result;
}
