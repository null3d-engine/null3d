// Copies that cull each group of their level draw what copies that cull only its pieces draw,
// pixel for pixel: the slot pass runs only on WebGPU's indirect path, which the first path takes,
// so the other paths check that groups change nothing where slots stay off. The side with groups
// must also draw fewer triangles in the first view, which shows that the slot pass culled them.
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
	{ name: 'webgpu', query: 'gpu=webgpu&direct=off', tier: 'webgpu', slots: true },
	{ name: 'webgpu direct draws', query: 'gpu=webgpu&direct=on', tier: 'webgpu', slots: false },
	{ name: 'webgpu-compat', query: 'gpu=compat&direct=off', tier: 'webgpu-compat', slots: false },
	{ name: 'webgl2', query: 'gpu=webgl2', tier: 'webgl2', slots: false },
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
		if (path.slots) expect(result.triangles.groups).toBeLessThan(result.triangles.pieces);
		else expect(result.triangles.groups).toBe(result.triangles.pieces);
	});
