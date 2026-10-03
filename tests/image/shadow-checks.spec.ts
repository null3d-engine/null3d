// The shadow checks of a still scene, on both GPU paths: shadows that stay still while the camera
// that places the cascades moves, shadow edges close to the reference's, and a long straight edge
// without stair steps. The visual page draws each frame in hold mode, so each run draws the same
// pixels, and the figures can have tight limits in CI. tests/pages/lib/shadow-check.ts says what
// each figure measures, and `VISUAL_LIMITS` why each limit sits where it does.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';
import { saveVisualResult, type VisualResult, visualProblems } from '../lib/visual-checks.ts';
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
