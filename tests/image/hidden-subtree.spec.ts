// Objects below a hidden ancestor stop updating, and take their place again in the frame that
// shows them. A rig moves while hidden, then shows in the same frame as its last move. Every frame
// drawn after the show must show the rig where it ends, as an engine that never hid it draws it,
// lit by the light that rides on it. A camera below a hidden body keeps following the body.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

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
		await page.goto(`hidden-subtree.html?gpu=${gpu}`);
		const result = await pageResult<HiddenResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		const { hide, reference } = result.pictures;
		expect(hide.failures).toEqual([]);
		expect(reference.failures).toEqual([]);
		// The camera below the hidden body followed it, and the rig shows where it ends.
		expect(hide.after === reference.after).toBe(true);
		// The rig was hidden while the scene held still.
		expect(hide.still === hide.after).toBe(false);
		// Each frame after the show draws the scene before it, or the rig in its last place.
		const sequence = hide.during
			.map((each) => (each === hide.still ? 'S' : each === hide.after ? 'A' : 'X'))
			.join('');
		expect(hide.during.length).toBeGreaterThan(0);
		expect(sequence, `frames after the show: ${sequence}`).not.toContain('X');
	});
