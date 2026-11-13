// The CPU preview's card level must draw as the engine's does, since builders judge their plants on
// it before a review draws them. One ash is drawn twice at its first card level, as the matte the
// review reads its outline from: by the review page on the GPU, and by the preview on the CPU from
// the camera the page posted, at the same size. The sky gap that the review reads inside the crown's
// outline must agree within 0.03 between the two.
import { expect, test } from '@playwright/test';
import { loadSpecies } from '../../packages/vegetation/src/core/registry.ts';
import {
	buildKitNow,
	growPlantNow,
	loadPlantCode,
} from '../../packages/vegetation/src/generate.ts';
import { aimedCamera, type V3 } from '../../tools/lib/plant-preview/camera.ts';
import { canvas, drawCardLevelWood, drawCards, matte } from '../../tools/lib/plant-preview/draw.ts';
import type { Rgba } from '../../tools/lib/plant-review/image.ts';
import { matteMask, measurePlant } from '../../tools/lib/plant-review/references.ts';
import { imageOf } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';

/** A tree whose whole views stand at its first card level, as the review's do. */
const SPECIES = 'common-ash';
/** The size the review draws a whole still at for its photographs. */
const SIZE = [768, 516] as const;
const GROWTH = { seed: 11, variant: 0 } as const;
/** How far the preview's sky gap may stand from the engine's. */
const BAND = 0.03;

/** The review page's whole view of the plant at its first card level, drawn as a matte. */
function reviewWindow(): string {
	const sketch =
		`/tests/pages/sketches/plant-review-sketch.ts?species=${SPECIES}&view=whole` +
		`&seed=${GROWTH.seed}&variant=${GROWTH.variant}&preset=high&lod=1&matte=1` +
		`&size=${SIZE[0]}x${SIZE[1]}&hold=1`;
	return `image.html?sketch=${encodeURIComponent(sketch)}&hold=1&size=${SIZE[0]}x${SIZE[1]}&preset=high`;
}

/** The sky gap inside a matte's crown outline, as the review reads it. */
function enclosedGap(image: Rgba): number {
	return measurePlant(image, matteMask(image)).gapFraction;
}

test("the preview's first card level holds the engine's sky gap", async ({ page }) => {
	test.setTimeout(240_000);
	const result = await loadResult(page, reviewWindow(), 150_000);
	expect(result.ok, failureText(result)).toBe(true);
	const engine = imageOf(result, SIZE);
	if (typeof engine === 'string') throw new Error(engine);
	const facts = (result.sketch as Record<string, unknown> | undefined)?.['plant-review'] as
		| { cells?: { camera?: { position: V3; target: V3; fov: number } }[] }
		| undefined;
	const posted = facts?.cells?.[0]?.camera;
	if (!posted) throw new Error('the review page posted no camera for its still');

	const module = await loadSpecies(SPECIES);
	await loadPlantCode(module.record);
	const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
	const asset = growPlantNow(kit, { ...GROWTH, season: kit.record.seasons.default, near: true });
	// One sample a pixel at the still's own size, as the engine draws it.
	const camera = aimedCamera(posted.position, posted.target, posted.fov, SIZE[0], SIZE[1]);
	const drawing = canvas(camera.width, camera.height);
	drawCardLevelWood(drawing, camera, kit, asset, 1);
	drawCards(drawing, camera, kit, asset, 1, SIZE[0]);
	const preview = matte(drawing, 1);

	const drawn = { engine: enclosedGap(engine), preview: enclosedGap(preview) };
	console.log(
		`sky gap inside the crown's outline: engine ${drawn.engine}, preview ${drawn.preview}`,
	);
	expect(Math.abs(drawn.preview - drawn.engine), JSON.stringify(drawn)).toBeLessThanOrEqual(BAND);
});
