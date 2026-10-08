// Draws each complete sketch that the agent skills and the docs' cookbook show in the engine's hold
// mode, on every GPU tier: it must set up, step and draw without an error. A sketch that picks a
// camera must also show more than its background, because code that runs can still draw nothing.
// The unit tests type check the same sketches. Sketches under a heading that names a later version
// are left out.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { watchConsole } from '../../packages/cli/src/page.js';
import { IMAGE_PAGE, SKETCH_SIZE, TIERS } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { REPO_ROOT } from '../lib/server.ts';
import { runnableSketches, SKETCH_DIR, writeSketches } from '../lib/skill-sketches.ts';

test.describe.configure({ mode: 'parallel' });

/** The sketch time that each sketch holds at: long enough for every setup and motion to run. */
const HOLD_SECONDS = 1;
/**
 * How long a page may take to publish its frame. A scene of thousands of objects takes several
 * times longer on CI's software GPU while other tests share its cores.
 */
const TIMEOUT_MS = 60_000;
/** Time to open each page, besides the time its frame may take. */
const LOAD_MS = 10_000;

const sketches = runnableSketches(REPO_ROOT);
const paths = writeSketches(REPO_ROOT, join(REPO_ROOT, SKETCH_DIR, 'hold'), sketches);

/**
 * The pixels of a frame whose color differs from the top-left pixel's. A frame that draws nothing
 * but the background has none.
 */
function drawnPixels(pixels: Buffer): number {
	let differ = 0;
	for (let i = 4; i < pixels.length; i += 4)
		if (
			pixels[i] !== pixels[0] ||
			pixels[i + 1] !== pixels[1] ||
			pixels[i + 2] !== pixels[2] ||
			pixels[i + 3] !== pixels[3]
		)
			differ++;
	return differ;
}

for (const sketch of sketches)
	for (const tier of TIERS)
		test(`${sketch.name} on ${tier} (${sketch.file}:${sketch.line})`, async ({ page }) => {
			test.setTimeout(TIMEOUT_MS + LOAD_MS);
			const { errors } = watchConsole(page);
			const [width, height] = SKETCH_SIZE;
			const path = `${IMAGE_PAGE}?gpu=${tier}&hold=${HOLD_SECONDS}&size=${width}x${height}&sketch=/${paths.get(sketch.name)}`;
			const result = await loadResult(page, path, TIMEOUT_MS);
			expect(result.ok ? [] : [failureText(result)]).toEqual([]);
			expect(errors).toEqual([]);
			if (sketch.draws && result.ok) {
				const pixels = Buffer.from(String(result.pixels), 'base64');
				expect(drawnPixels(pixels)).toBeGreaterThan(0);
			}
		});
