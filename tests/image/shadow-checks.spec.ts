// The shadow checks of a still scene, on both GPU paths: shadows that stay still while the camera
// that places the cascades moves, shadow edges close to the reference's, and a long straight edge
// without stair steps. The visual page draws each frame in hold mode, so each run draws the same
// pixels, and the figures can have tight limits in CI. tests/pages/lib/shadow-check.ts says what
// each figure measures, and `VISUAL_LIMITS` why each limit sits where it does. The long edge crosses
// the seam between two cascades, which the blend between them hides. The same scene far from the
// world's origin, in large-world mode, must meet the same limits: the cascades of a large world
// stay as still and as sharp as at the origin.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';
import {
	saveVisualResult,
	VISUAL_LIMITS,
	type VisualResult,
	visualProblems,
} from '../lib/visual-checks.ts';
import { FLIGHTS } from '../pages/lib/jitter.ts';
import { SHADOW_SCENE_EDGE } from '../pages/lib/shadow-check.ts';

const SCENE = '/tests/pages/sketches/shadow-scene-sketch.ts';

/** The scene at the origin, and at each distance of the large-world flights that has its cells. */
const PLACES = FLIGHTS.filter((flight) => !flight.cellsFull);

for (const { name, distance } of PLACES)
	for (const gpu of ['webgpu', 'webgl2'] as const)
		test(`shadows stay still and their edges stay smooth ${distance === 0 ? '' : `${name} from the origin `}on ${gpu}`, async ({
			page,
		}) => {
			test.setTimeout(180_000);
			const query = new URLSearchParams({
				gpu,
				scene: distance === 0 ? SCENE : `${SCENE}?distance=${distance}`,
				at: '0',
				edge: SHADOW_SCENE_EDGE.join(','),
				moving: '0',
			});
			await page.goto(`visual.html?${query}&images${distance === 0 ? '' : '&largeWorld'}`);
			const result = await pageResult<VisualResult>(page, 150_000);
			expect(result.error).toBeUndefined();
			const folder = distance === 0 ? 'shadow-scene' : `shadow-scene-${name}`;
			saveVisualResult(join(REPO_ROOT, 'test-results', 'visual', folder, gpu), result);
			expect(result.edges.steps?.rows, 'rows where the long edge was found').toBeGreaterThan(80);
			expect(visualProblems('shadow-scene', result)).toEqual([]);
		});

// The long edge crosses the seam between the first two cascades. With no blend between them, its
// softness jumps there in one row, so the seam check must fail the frame: the check sees seams.
for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`the seam check finds the line where cascades meet with no blend on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const query = new URLSearchParams({
			gpu,
			scene: `${SCENE}?blend=0`,
			at: '0',
			edge: SHADOW_SCENE_EDGE.join(','),
			moving: '0',
		});
		await page.goto(`visual.html?${query}`);
		const result = await pageResult<VisualResult>(page, 150_000);
		expect(result.error).toBeUndefined();
		const limit = VISUAL_LIMITS['shadow-scene']?.seamPixels ?? 0;
		expect(result.edges.seamPixels).toBeGreaterThan(2 * limit);
	});

// Without large-world mode, a scene far from the origin keeps 32-bit positions, whose steps there
// are far coarser than a shadow texel, so the checks must find the fault: they can see it.
for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`the checks find the shadows of a far scene without large-world mode on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const far = PLACES[PLACES.length - 1] as (typeof PLACES)[number];
		const query = new URLSearchParams({
			gpu,
			scene: `${SCENE}?distance=${far.distance}`,
			at: '0',
			edge: SHADOW_SCENE_EDGE.join(','),
			moving: '0',
		});
		await page.goto(`visual.html?${query}&images`);
		const result = await pageResult<VisualResult>(page, 150_000);
		saveVisualResult(
			join(REPO_ROOT, 'test-results', 'visual', `shadow-scene-${far.name}-small-world`, gpu),
			result,
		);
		expect(visualProblems('shadow-scene', result)).not.toEqual([]);
	});
