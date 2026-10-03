// The contact checks of car-sized boxes under S4's sun, on both GPU paths: how much light shows
// between each box's foot and the start of its shadow, near the camera, in the last cascade and
// past the end of the first, and how much shadow the boxes cast on their own lit tops. With a
// ground that casts shadows too, its top must stay lit. With the boxes on a pavement slab that
// casts shadows, under S4's sun and two lower suns, the slab's lit top must show little acne. The
// visual page draws each frame in hold mode, so each run draws the same pixels.
// tests/pages/lib/shadow-check.ts says what the figures measure, and `CONTACT_LIMITS` why each
// limit sits where it does.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';
import {
	CONTACT_LIMITS,
	type ContactCase,
	contactProblems,
	saveVisualResult,
	type VisualResult,
} from '../lib/visual-checks.ts';

const SCENE = '/tests/pages/sketches/shadow-contact-sketch.ts';

for (const name of Object.keys(CONTACT_LIMITS) as ContactCase[])
	for (const gpu of ['webgpu', 'webgl2'] as const)
		test(`shadows meet their casters in the contact scene's ${name} view on ${gpu}`, async ({
			page,
		}) => {
			test.setTimeout(180_000);
			const { query } = CONTACT_LIMITS[name];
			const pageQuery = new URLSearchParams({
				gpu,
				scene: `${SCENE}?${query}`,
				at: '0',
				moving: '0',
			});
			await page.goto(`visual.html?${pageQuery}&images`);
			const result = await pageResult<VisualResult>(page, 150_000);
			expect(result.error).toBeUndefined();
			saveVisualResult(join(REPO_ROOT, 'test-results', 'visual', `contact-${name}`, gpu), result);
			test.info().annotations.push({
				type: 'contact',
				description: JSON.stringify({
					...result.contact,
					shadowed: result.stability.shadowedPercent,
					acne: result.acne,
				}),
			});
			expect(contactProblems(name, result)).toEqual([]);
		});
