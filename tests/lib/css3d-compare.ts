// The reading of a port of one of three.js's CSS3D examples (tests/pages/lib/css3d-example.ts). The
// page draws its scene twice, by null3D and by three.js's CSS3DRenderer, and publishes each
// element's box. This module loads the page on each GPU path, checks that both stages drew their
// elements, hides both canvases, and compares the pixels of the two layers of elements.
//
// A port whose example also draws a scene through WebGL gives its twin the same scene. The page
// reads the engine's frame through `captureFrame` and the twin's through WebGL's own readback, and
// publishes both, so this module compares the drawn scenes too. A browser screenshot never reads a
// GPU's pixels (hard rule 16): the screenshots hold only the elements, which no GPU draws.
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

/**
 * The most of the drawn scene that may differ: three.js's own rule. A port whose cut-out plane goes
 * missing differs by more, so the rule catches it.
 */
const MAX_SCENE_DIFFERENCE = 0.001;

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
	/**
	 * The drawn scenes of the two stages as base64 RGBA rows, for a port whose twin draws the
	 * example's scene. The engine's frame comes from `captureFrame` and the twin's from WebGL's own
	 * readback, so neither comes from a browser screenshot.
	 */
	frames?: { mine: string; theirs: string };
	mode: { hold: number | null };
}

/** How far an element's box may sit from three.js's, in CSS pixels. */
const BOX_TOLERANCE = 1.5;

/** The shares of the picture that a port's test may allow to differ. */
export interface CompareLimits {
	/** The share of the elements' layer that may differ. */
	elements?: number;
	/** The share of a drawn scene that may differ. */
	scene?: number;
}

/**
 * Loads a port at one GPU path and compares its stage with three.js's own draw. Returns the page's
 * result, so a test can assert on the scene it drew. `limits` widens a share that the two engines
 * shade a little differently.
 */
export async function expectSameElements(
	page: Page,
	name: string,
	gpu: string,
	limits: CompareLimits = {},
): Promise<PortResult> {
	const maxDifference = limits.elements ?? MAX_DIFFERENCE;
	const maxSceneDifference = limits.scene ?? MAX_SCENE_DIFFERENCE;
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

	// Hide both canvases, so the screenshots hold the elements and the stage's background alone. A
	// GPU's pixels never come from a browser screenshot: the page publishes the two frames, which
	// this reads through each engine.
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
	).toBeLessThanOrEqual(maxDifference);

	// A drawn scene compares as its two engines read it: the engine's frame through `captureFrame`
	// and the twin's through WebGL. A surface that the engine draws over the page shows here, since
	// the twin's own cut-out leaves those pixels empty.
	if (result.frames) {
		const size = result.stage.width * result.stage.height * 4;
		const drawn = (data: string) => {
			const pixels = new Uint8Array(Buffer.from(data, 'base64'));
			expect(pixels.length, 'the frame holds four bytes a pixel').toBe(size);
			return { width: result.stage.width, height: result.stage.height, data: pixels };
		};
		const mineFrame = drawn(result.frames.mine);
		const theirFrame = drawn(result.frames.theirs);
		// Each engine must have drawn something: a blank frame would compare equal to another one.
		const lit = (image: { data: Uint8Array }) => {
			let count = 0;
			for (let i = 3; i < image.data.length; i += 4) if ((image.data[i] as number) > 8) count++;
			return count;
		};
		expect(lit(mineFrame), 'the scene that the engine drew').toBeGreaterThan(1_000);
		expect(lit(theirFrame), 'the scene that three.js drew').toBeGreaterThan(1_000);
		const scene = compareImages(theirFrame, mineFrame, 0.1);
		console.log(
			`${name} at ${gpu}: ${percent(scene.share)} of the scene differs from three.js's draw`,
		);
		expect(
			scene.share,
			`${percent(scene.share)} of the scene differs from three.js's draw at ${gpu}`,
		).toBeLessThanOrEqual(maxSceneDifference);
	}
	return result;
}
