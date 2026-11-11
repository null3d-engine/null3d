// Copies that cull each piece of their mesh draw what copies that draw it whole draw, pixel for
// pixel, on every GPU path: the culling shader on WebGPU, the CPU culling of the direct-draw path
// and the job workers' culling on WebGL2. In the first view the pieces must also cut the triangles
// drawn, so the test fails when the pieces never reach the culling. Each side must draw a frame in
// the window that measures its triangles, so a window that caught none fails rather than judging an
// empty measure. A file's house that too few copies draw must draw whole: the same triangles and
// draws as the house without pieces.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface PiecesResult {
	error?: string;
	tier: string;
	directDraws: boolean;
	views: number;
	differingPixels: number[];
	triangles: { whole: number; pieces: number };
	draws: { whole: number; pieces: number };
	failures: string[];
}

const PATHS = [
	{ name: 'webgpu', query: 'gpu=webgpu&direct=off', tier: 'webgpu' },
	{ name: 'webgpu direct draws', query: 'gpu=webgpu&direct=on', tier: 'webgpu' },
	{ name: 'webgpu-compat', query: 'gpu=compat&direct=off', tier: 'webgpu-compat' },
	{ name: 'webgl2', query: 'gpu=webgl2', tier: 'webgl2' },
] as const;

const SCENES = [
	{ name: "a file's rock field", query: '', culls: true },
	{ name: 'a village of one house made in code', query: '&scene=houses', culls: true },
	{
		name: "a village of a file's house copied in code",
		query: '&scene=houses&file=1',
		culls: true,
	},
	{
		name: "a village of a file's house that too few copies draw",
		query: '&scene=houses&file=1&copies=8',
		culls: false,
	},
] as const;

for (const scene of SCENES)
	for (const path of PATHS)
		test(`copies that cull their mesh's pieces draw the whole mesh's picture in ${scene.name} on ${path.name}`, async ({
			page,
		}) => {
			test.setTimeout(240_000);
			await page.goto(`mesh-pieces.html?${path.query}${scene.query}`);
			const result = await pageResult<PiecesResult>(page, 200_000);
			console.log(`mesh pieces in ${scene.name} on ${path.name}: ${JSON.stringify(result)}`);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(path.tier);
			expect(result.failures).toEqual([]);
			expect(result.differingPixels).toEqual(new Array(result.views).fill(0));
			// Each side recorded the triangles of a drawn frame, so a window that caught none fails
			// rather than comparing an empty measurement.
			expect(result.triangles.whole).toBeGreaterThan(0);
			expect(result.triangles.pieces).toBeGreaterThan(0);
			if (scene.culls) expect(result.triangles.pieces).toBeLessThan(result.triangles.whole);
			else {
				expect(result.triangles.pieces).toBe(result.triangles.whole);
				expect(result.draws.pieces).toBe(result.draws.whole);
			}
		});
