// The shadow checks of a still scene, on both GPU paths: shadows that stay still while the camera
// that places the cascades moves, shadow edges close to the reference's, and a long straight edge
// without stair steps. The visual page draws each frame in hold mode, so each run draws the same
// pixels, and the figures can have tight limits in CI. tests/pages/lib/shadow-check.ts says what
// each figure measures, and `VISUAL_LIMITS` why each limit sits where it does. The long edge crosses
// the seam between two cascades, which the blend between them hides.
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
import { SHADOW_SCENE_EDGE } from '../pages/lib/shadow-check.ts';

const SCENE = '/tests/pages/sketches/shadow-scene-sketch.ts';

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`shadows stay still and their edges stay smooth on ${gpu}`, async ({ page }) => {
		test.setTimeout(180_000);
		const query = new URLSearchParams({
			gpu,
			scene: SCENE,
			at: '0',
			edge: SHADOW_SCENE_EDGE.join(','),
			moving: '0',
		});
		await page.goto(`visual.html?${query}&images`);
		const result = await pageResult<VisualResult>(page, 150_000);
		expect(result.error).toBeUndefined();
		saveVisualResult(join(REPO_ROOT, 'test-results', 'visual', 'shadow-scene', gpu), result);
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
