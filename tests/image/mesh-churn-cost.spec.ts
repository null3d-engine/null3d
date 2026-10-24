// What a frame costs on the Mac's GPU when a model's mesh leaves the scene, and when one arrives:
// the 240 independent meshes of the mesh-churn-cost page, in a window that changes nothing, a
// window that removes one mesh a frame, and a window that adds one a frame, three times each. The
// difference between the churn windows and the idle one is the render worker's cost of a removal,
// which closes a hole in its mesh page by moving every mesh after it and uploading their bytes
// again, and of an addition, which appends. It prints the medians of each side for D-244. It runs
// only with NULL3D_MESH_CHURN_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_MESH_CHURN_COST=1 bun run test:browser -- mesh-churn-cost.spec.ts.
import { expect, test } from '@playwright/test';
import { browserOptions, GPU_TIMING_ARGS } from '../../packages/cli/src/browser.js';
import { COST_PAGE_MS, COST_TEST_MS, load, waitForQuietLoad } from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';

// Chrome rounds the GPU timestamps it reports unless its developer features are on.
test.use({
	launchOptions: {
		...browserOptions('chrome-real-gpu'),
		args: [...GPU_TIMING_ARGS],
	},
});

test.skip(!process.env.NULL3D_MESH_CHURN_COST, 'set NULL3D_MESH_CHURN_COST to time the churn');

const gpus = (process.env.NULL3D_MESH_CHURN_GPUS ?? 'webgpu,webgl2').split(',');

interface Side {
	frames: number;
	intervalMs: number;
	renderWorkerMs: number;
	sketchMs: number | null;
	uploadBytes: number;
	gpuMs: number | null;
}

interface ChurnResult {
	error?: string;
	tier: string;
	threads: string;
	window: [number, number];
	models: number;
	trialSeconds: number;
	idle: Side[];
	destroy: Side[];
	create: Side[];
	failures: string[];
}

const median = (values: number[]): number => {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] as number;
};

const sketch = (sides: Side[]): number =>
	median(sides.flatMap((s) => (s.sketchMs === null ? [] : [s.sketchMs])));

const line = (name: string, sides: Side[]): string =>
	`${name}: render worker ${median(sides.map((s) => s.renderWorkerMs)).toFixed(3)} ms a frame, ` +
	`sketch ${sketch(sides).toFixed(3)} ms, ` +
	`upload ${Math.round(median(sides.map((s) => s.uploadBytes)))} bytes, ` +
	`interval ${median(sides.map((s) => s.intervalMs)).toFixed(2)} ms, ` +
	`GPU ${median(sides.flatMap((s) => (s.gpuMs === null ? [] : [s.gpuMs]))).toFixed(2)} ms, ` +
	`${median(sides.map((s) => s.frames))} frames`;

for (const gpu of gpus)
	test(`a mesh's removal and its addition, on ${gpu}`, async ({ page }) => {
		test.setTimeout(COST_TEST_MS);
		await waitForQuietLoad();
		const loadBefore = load();
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto(`mesh-churn-cost.html?gpu=${gpu}&preset=low&prepass=off`);
		const result = await pageResult<ChurnResult>(page, COST_PAGE_MS);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		const idle = sketch(result.idle);
		const destroy = sketch(result.destroy);
		const create = sketch(result.create);
		console.log(
			[
				`${result.tier} on ${result.threads}, load ${loadBefore} before and ${load()} after`,
				line('idle', result.idle),
				line('remove', result.destroy),
				line('add', result.create),
				`a removal costs ${(destroy - idle).toFixed(3)} ms of the sketch worker's own code, an addition ${(create - idle).toFixed(3)} ms`,
			].join('\n'),
		);
	});
