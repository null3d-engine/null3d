// The visual checks of the benchmark scenes that draw shadows, on both GPU paths: their shadows stay
// still while the camera that places the cascades moves, and their shadow edges stay close to the
// reference's. The visual page draws every frame in hold mode on the dev server, so CI's software
// GPU draws the same pixels on every run.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { watchConsole } from '../../packages/cli/src/page.js';
import { pageResult } from '../../tests/lib/page-result.ts';
import { HTTP_PORT, REPO_ROOT } from '../../tests/lib/server.ts';
import {
	saveVisualResult,
	type VisualResult,
	visualProblems,
} from '../../tests/lib/visual-checks.ts';
import { readSwitches } from '../lib/parity';
import { SHADOW_SCENES, visualPagePath } from '../lib/visual';

/** The switches that NULL3D_SWITCHES adds to every page, such as shadowdepth=32, or none. */
const extraSwitches =
	process.env.NULL3D_SWITCHES && readSwitches(process.env.NULL3D_SWITCHES, 'NULL3D_SWITCHES');

/** How long a visual page may take: twelve starts of a scene, which take longest for S4 in CI. */
const VISUAL_TIMEOUT_MS = 240_000;

for (const { scene, shadows, n } of SHADOW_SCENES)
	for (const gpu of ['webgpu', 'webgl2'] as const)
		test(`${scene}'s shadows stay still and keep their edges on ${gpu}`, async ({ page }) => {
			test.setTimeout(VISUAL_TIMEOUT_MS + 30_000);
			const { errors } = watchConsole(page);
			const path = visualPagePath(scene, gpu, { n, shadows, images: true });
			const switches = extraSwitches ? `&${extraSwitches}` : '';
			await page.goto(`http://localhost:${HTTP_PORT}${path}${switches}`);
			const result = await pageResult<VisualResult>(page, VISUAL_TIMEOUT_MS);
			expect(result.error).toBeUndefined();
			expect(errors).toEqual([]);
			saveVisualResult(join(REPO_ROOT, 'test-results', 'visual', scene, gpu), result);
			expect(visualProblems(scene, result)).toEqual([]);
		});
