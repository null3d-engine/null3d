// Objects below a hidden ancestor stop updating, and take their place again in the frame that
// shows them. A rig moves while hidden, then shows in the same frame as its last move. Every frame
// drawn after the show must show the rig where it ends, as an engine that never hid it draws it,
// lit by the light that rides on it. A camera below a hidden body keeps following the body.
import { expect, test } from '@playwright/test';
import { differentShare } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

/**
 * The most a channel may differ for two pixels to count as the same, and the share of pixels that
 * may differ between the two engines. The camera's world is built through a parent in one engine
 * and placed directly in the other, so their matrices round apart in the last bits and a pixel on
 * an edge can flip. That is a few tenths of a per cent at this channel difference, while a frame
 * that misses the rig or draws it in the wrong place moves whole groups of pixels.
 */
const CHANNEL = 64;
const SAME = 0.01;

/** The share of pixels that differ between two of the page's pictures. */
const share = (a: string, b: string) =>
	differentShare(Buffer.from(a, 'base64'), Buffer.from(b, 'base64'), CHANNEL);

interface Picture {
	still: string;
	after: string;
	during: string[];
	latency: string;
	failures: string[];
}

interface HiddenResult {
	error?: string;
	pictures: Record<'hide' | 'reference', Picture>;
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`objects below a hidden ancestor draw in place in the frame that shows them, on ${gpu}`, async ({
		page,
	}) => {
		// CI's software GPU drew this page in 49.4 and 50.1 seconds on the webgpu tier, and cut it
		// at 60 on a slower run. Both waits allow twice that figure.
		test.setTimeout(150_000);
		await page.goto(`hidden-subtree.html?gpu=${gpu}`);
		const result = await pageResult<HiddenResult>(page, 120_000);
		expect(result.error).toBeUndefined();
		const { hide, reference } = result.pictures;
		expect(hide.failures).toEqual([]);
		expect(reference.failures).toEqual([]);
		// The camera below the hidden body followed it, and the rig shows where it ends.
		expect(
			share(hide.after, reference.after),
			'the shown rig matches the reference',
		).toBeLessThanOrEqual(SAME);
		// The rig was hidden while the scene held still.
		expect(share(hide.still, hide.after), 'the rig moved after it showed').toBeGreaterThan(SAME);
		// Each frame after the show draws the scene before it, or the rig in its last place.
		const sequence = hide.during
			.map((each) =>
				share(each, hide.still) <= SAME ? 'S' : share(each, hide.after) <= SAME ? 'A' : 'X',
			)
			.join('');
		expect(hide.during.length).toBeGreaterThan(0);
		expect(sequence, `frames after the show: ${sequence}`).not.toContain('X');
	});
