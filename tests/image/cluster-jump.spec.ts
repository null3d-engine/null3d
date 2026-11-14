// A ground drawn from its tree of cluster patches keeps drawing under a batch of spheres with
// levels of detail, at the start and after camera jumps that change the spheres' levels
// (tests/pages/cluster-jump.ts). The spheres' buckets put draws and copies before the ground's, so
// the cluster pass must read the ground's copy where its bucket's slice now starts and write the
// ground's draw where the opaque pass reads it. Either fault drew no ground, and the background
// showed through below the horizon. The cluster pass runs on WebGPU's indirect path, so the test
// forces it.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	/** The share of the picture's lowest quarter that shows the background, at each camera place. */
	shares: number[];
	failures: string[];
}

/** The share of the lowest quarter that the background may show: the ground covers nearly all of it. */
const MOST_BACKGROUND = 0.05;

test('a cluster ground draws under meshes with levels, at the start and after camera jumps', async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.goto('cluster-jump.html?direct=off');
	const result = await pageResult<Result>(page, 90_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.tier).toBe('webgpu');
	expect(result.shares).toHaveLength(7);
	for (const [k, share] of result.shares.entries())
		expect(share, `the background below the horizon at place ${k}`).toBeLessThan(MOST_BACKGROUND);
});
