// What the slot pass costs and saves: the rock field of `pages/mesh-groups-cost.ts` timed with the
// fine level's groups (which the camera's view culls through its slots) and without them, in turns,
// at two canvas sizes. A small canvas puts the work in the triangles that the slots cull; a large
// one puts it in the pixels that they do not. It prints each side's medians and the triangles and
// draws that each drew. It runs only with NULL3D_MESH_GROUPS_COST set, in a quiet window on a
// computer with a GPU of its own: NULL3D_MESH_GROUPS_COST=1 bun run test:browser -- mesh-groups-cost.spec.ts.
import { expect, test } from '@playwright/test';
import { costTimeout, sideLine, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** One side's figures, as the page reports them. */
interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
	gpuRoundsMs: number[];
	intervalRoundsMs: number[];
	triangles: number | null;
	draws: number | null;
}

interface CostResult {
	error?: string;
	tier: string;
	window: [number, number];
	off: Side;
	on: Side;
	failures: string[];
}

const SIZES = [
	{ name: 'a small canvas, short of triangles', size: { width: 320, height: 180 }, pixels: '' },
	{
		name: 'a large canvas, short of pixels',
		size: { width: 1600, height: 900 },
		pixels: '&pixels=large',
	},
] as const;

const ms = (value: number | null | undefined) => (value == null ? '-' : value.toFixed(2));

for (const { name, size, pixels } of SIZES)
	test(`the slot pass on the rock field at ${name}`, async ({ page }) => {
		test.skip(!process.env.NULL3D_MESH_GROUPS_COST, 'set NULL3D_MESH_GROUPS_COST to time the pass');
		test.setTimeout(costTimeout(600_000));
		const loadBefore = await waitForQuiet();
		await page.setViewportSize(size);
		// `NULL3D_MESH_GROUPS_ROCKS` sets the copies of the field, for a scene where the few nearest
		// copies carry most of its triangles, which is where the slots have triangles to cull.
		const rocks = process.env.NULL3D_MESH_GROUPS_ROCKS;
		const copies = rocks ? `&rocks=${rocks}` : '';
		await page.goto(`mesh-groups-cost.html?gpu=webgpu&direct=off${pixels}${copies}`);
		const result = await pageResult<CostResult>(page, 400_000);
		console.log(`slot cost at ${name}, load ${loadBefore} to ${result.tier}`);
		console.log(sideLine('pieces alone', result.off, 2, true));
		console.log(sideLine('with slots', result.on, 2, true));
		console.log(
			`triangles ${result.off.triangles} to ${result.on.triangles}, draws ${result.off.draws} to ${result.on.draws}`,
		);
		console.log(
			`GPU rounds off ${result.off.gpuRoundsMs.map(ms).join(' ')}, on ${result.on.gpuRoundsMs.map(ms).join(' ')}`,
		);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
	});
