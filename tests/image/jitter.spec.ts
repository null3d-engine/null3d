// The large-world jitter check on every GPU path: a camera flies past objects 1,000 km and 6,378 km
// from the origin in large-world mode, and each object's motion from frame to frame must match the
// same flight at the origin. The same far flights with every grid cell taken, as without cells,
// must show the jitter, so the check can see it, and the engine must warn once in each of them that
// the cells ran out. tests/pages/lib/jitter.ts says what the figures measure.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { jitterRows, saveJitterResult } from '../lib/jitter-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { REPO_ROOT } from '../lib/server.ts';
import { FLIGHTS, type JitterResult, jitterProblems } from '../pages/lib/jitter.ts';

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`a flight far from the origin moves as the flight at the origin does, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const warnings: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'warning' && message.text().includes('grid cells are in use'))
				warnings.push(message.text());
		});
		await page.goto(`jitter.html?gpu=${gpu}&images`);
		const result = await pageResult<JitterResult>(page, 150_000);
		expect(result.error).toBeUndefined();
		saveJitterResult(join(REPO_ROOT, 'test-results', 'jitter', gpu), result);
		console.log(jitterRows(gpu, result).join('\n'));
		expect(jitterProblems(result)).toEqual([]);
		expect(warnings).toHaveLength(FLIGHTS.filter((flight) => flight.cellsFull).length);
	});
