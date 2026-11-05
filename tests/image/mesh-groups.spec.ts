// Copies whose level carries groups draw what copies that cull only its pieces draw, pixel for
// pixel. The groups of this rock field are small, so the slot pass's gate keeps the slots off: the
// two sides must draw the same triangles too, which shows that a scene the pass does not pay for is
// unchanged. `mesh-groups-cost.spec.ts` holds the other side of the gate, on a rock whose copies
// carry enough triangles for the slots to pay.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface GroupsResult {
	error?: string;
	tier: string;
	directDraws: boolean;
	views: number;
	differingPixels: number[];
	triangles: { pieces: number; groups: number };
	draws: { pieces: number; groups: number };
	failures: string[];
}

const PATHS = [
	{ name: 'webgpu', query: 'gpu=webgpu&direct=off', tier: 'webgpu' },
	{ name: 'webgpu direct draws', query: 'gpu=webgpu&direct=on', tier: 'webgpu' },
	{ name: 'webgpu-compat', query: 'gpu=compat&direct=off', tier: 'webgpu-compat' },
	{ name: 'webgl2', query: 'gpu=webgl2', tier: 'webgl2' },
] as const;

for (const path of PATHS)
	test(`copies that cull their level's groups draw the pieces' picture on ${path.name}`, async ({
		page,
	}) => {
		test.setTimeout(240_000);
		await page.goto(`mesh-groups.html?${path.query}`);
		const result = await pageResult<GroupsResult>(page, 200_000);
		console.log(`mesh groups on ${path.name}: ${JSON.stringify(result)}`);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(path.tier);
		expect(result.failures).toEqual([]);
		expect(result.differingPixels).toEqual(new Array(result.views).fill(0));
		// The gate keeps the slots off for this scene, on every path.
		expect(result.triangles.groups).toBe(result.triangles.pieces);
	});
