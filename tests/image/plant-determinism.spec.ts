// Every plant species, and the stand-in species, grows the same bytes in the browser's job worker as
// in this test's own process. The page grows each one through the vegetation add-on's task and
// publishes the digest of variant 0; this test grows the same species and seed here and compares,
// so the reference is computed live and never stored. The plant core's own trigonometry is what
// keeps the two equal across script engines.
import { expect, test } from '@playwright/test';
import { plantAssetDigest } from '../../packages/vegetation/src/asset.ts';
import {
	buildKitNow,
	growPlantNow,
	loadPlantCode,
} from '../../packages/vegetation/src/generate.ts';
import { pageResult } from '../lib/page-result.ts';
import {
	DETERMINISM_GROWTH,
	determinismEntries,
	type GrownDigest,
} from '../pages/lib/plant-determinism.ts';

/** What the page reported. */
interface Result {
	ok: boolean;
	error?: string;
	species: GrownDigest[];
}

test('every plant species grows the same bytes in a job worker as in the test', async ({
	page,
}) => {
	// This test's wait, the page result's and the page's own nest, each wider than the one inside it,
	// so a slow runner meets the innermost limit first and the failure names the true wait. The page
	// answers in 37 to 42 seconds here and a runner 30 per cent slower lands at 98 to 117 seconds.
	test.setTimeout(240_000);
	const workerUrls: string[] = [];
	page.on('worker', (worker) => workerUrls.push(worker.url()));
	await page.goto('plant-determinism.html');
	const result = await pageResult<Result>(page, 180_000);
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	const here: GrownDigest[] = [];
	for (const entry of determinismEntries()) {
		const module = await entry.load();
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { placeholders: entry.placeholders });
		here.push({ id: entry.id, digest: plantAssetDigest(growPlantNow(kit, DETERMINISM_GROWTH)) });
	}
	expect(result.species).toEqual(here);
	const worker = workerUrls.some(
		(url) => url.includes('job-worker') || url.includes('task-worker'),
	);
	expect(worker, workerUrls.join('\n')).toBe(true);
});
