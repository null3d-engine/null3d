// The desert's pages, the scene that compares null3D with three.js's meshlet renderer: each engine's
// page runs a short timed run and reports what it drew, and both draw the same size. The check reads
// no timing. The scene needs its model files, which the first run builds in a few minutes, and a
// GPU of the computer's own: SwiftShader would take far longer than a test may over 1.7 billion
// triangles at full detail, so CI's software runs leave it out.
import { expect, test } from '@playwright/test';
import { defaultEnvironment } from '../../packages/cli/src/browser.js';
import { REPO_ROOT } from '../../tests/lib/server.ts';
import { ensureDesertFiles } from '../lib/desert-files';
import { MATCH_PAGES, pagePath } from '../lib/parity';
import type { BenchResult } from '../lib/report';
import { DESERT_CANVAS, DESERT_COUNT } from '../scenes/desert';
import { runPage } from './open-page';

/** How long one desert page may take, its load included: three.js builds its meshlets first. */
const DESERT_PAGE_MS = 10 * 60_000;
/** How long the model files may take to build, the first time on a computer. */
const BUILD_MS = 15 * 60_000;

test.describe('the desert', () => {
	test.skip(
		defaultEnvironment() === 'chromium-swiftshader',
		'SwiftShader draws the desert far too slowly; the scene runs on real GPUs only',
	);
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		test.setTimeout(BUILD_MS);
		await ensureDesertFiles(REPO_ROOT);
	});

	for (const switches of ['view=walk', 'view=aerial&shadows=3']) {
		test(`both engines report the same drawn size, ${switches}`, async ({ page }) => {
			test.setTimeout(2 * DESERT_PAGE_MS);
			const drawn: string[] = [];
			for (const kind of MATCH_PAGES.desert) {
				const result = await runPage<BenchResult>(
					page,
					pagePath('desert', kind, `${switches}&seconds=1`),
					DESERT_PAGE_MS,
				);
				expect(result.scene).toBe('desert');
				expect(result.n).toBe(DESERT_COUNT);
				expect(result.frames).toBeGreaterThan(0);
				const desert = result.desert;
				if (!desert) throw new Error(`${kind} reported no desert figures`);
				expect(desert.view).toBe(switches.includes('aerial') ? 'aerial' : 'walk');
				expect(desert.shadows === null).toBe(!switches.includes('shadows'));
				expect(desert.triangles).toBeGreaterThan(0);
				drawn.push(`${desert.drawn.width} x ${desert.drawn.height}`);
			}
			expect(drawn).toEqual(
				MATCH_PAGES.desert.map(() => `${DESERT_CANVAS.width} x ${DESERT_CANVAS.height}`),
			);
		});
	}
});
