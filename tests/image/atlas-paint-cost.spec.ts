// What the bark and the leaf atlas cost to paint, on this Mac's own GPU: the painters of
// tests/pages/atlas-paint-cost.html, three rounds of each in turn. The figures are the paint alone,
// with no texture upload and no drawing between the calls. It runs only with
// NULL3D_ATLAS_PAINT_COST set, as the car paint's page does:
// NULL3D_ATLAS_PAINT_COST=1 bun run test:browser -- atlas-paint-cost.spec.ts. The device runner's
// atlas-paint plan measures the same page on a tablet and a phone (.dev/devices.md).
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** What the atlas paint page publishes. */
interface PaintResult {
	ok: boolean;
	error?: string;
	/** Each round's time for the two paints. */
	times?: { bark: number; leaf: number }[];
	/** The middle figure of the rounds, in milliseconds. */
	barkMs?: number;
	leafMs?: number;
	failures?: string[];
}

test('the bark and the leaf atlas paint, timed apart', async ({ page }) => {
	test.skip(
		!process.env.NULL3D_ATLAS_PAINT_COST,
		'set NULL3D_ATLAS_PAINT_COST to time the atlases',
	);
	test.setTimeout(costTimeout(180_000));
	const loadBefore = await waitForQuiet();
	await page.goto('atlas-paint-cost.html');
	const result = await pageResult<PaintResult>(page, 120_000);
	expect(result.error).toBeUndefined();
	const rounds = result.times ?? [];
	console.log(
		[
			`ATLASPAINT load ${loadBefore} before and ${loadNow()} after`,
			...rounds.map(
				(time, round) =>
					`ATLASPAINT round ${round + 1}: bark ${time.bark.toFixed(1)} ms, leaf ${time.leaf.toFixed(1)} ms`,
			),
			`ATLASPAINT middle: bark ${result.barkMs?.toFixed(1)} ms, leaf ${result.leafMs?.toFixed(1)} ms`,
		].join('\n'),
	);
	expect(result.failures).toEqual([]);
	expect(rounds.length).toBeGreaterThan(0);
	expect(result.barkMs).toBeGreaterThan(0);
	expect(result.leafMs).toBeGreaterThan(0);
});
