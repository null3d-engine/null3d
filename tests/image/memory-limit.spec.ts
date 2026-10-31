// A large scene near its memory limit: each first frame either draws or stops with the error that
// names full memory, whichever way the heap lies, and the core never traps. The draw path sets how
// much the first frame asks for, so each limit runs on both paths.
import { expect, test } from '@playwright/test';

/** The limits to try in MiB: under, around and over what the island scene's first frame needs. */
const LIMITS = [440, 508, 516, 520, 640, 710, 720];
/** How many times each limit and path runs: the heap's layout varies from run to run. */
const REPEATS = 2;

test('a first frame near the memory limit never traps', async ({ page, browserName }, info) => {
	test.skip(
		browserName !== 'chromium' || info.project.name !== 'chrome-real-gpu',
		'the scene takes minutes to draw on a software GPU',
	);
	test.setTimeout(600_000);
	const stops: string[] = [];
	for (const direct of ['on', 'off'])
		for (const memory of LIMITS)
			for (let run = 0; run < REPEATS; run++) {
				const query = new URLSearchParams({
					sketch: '/examples/showcase/island/sketch.ts',
					hold: '1',
					size: '640x360',
					preset: 'high',
					gpu: 'webgpu',
					direct,
					memory: `${memory}`,
				});
				await page.goto(`/tests/pages/image.html?${query}`);
				await page.waitForFunction(
					() => (globalThis as { __null3dHold?: unknown }).__null3dHold !== undefined,
					undefined,
					{ timeout: 120_000 },
				);
				const { ok, error } = await page.evaluate(() => {
					const hold = (globalThis as { __null3dHold?: { ok: boolean; error?: string } })
						.__null3dHold;
					return { ok: hold?.ok ?? false, error: hold?.error ?? '' };
				});
				if (!ok && !error.includes('E1109')) stops.push(`${direct} ${memory}: ${error}`);
			}
	expect(stops).toEqual([]);
});
