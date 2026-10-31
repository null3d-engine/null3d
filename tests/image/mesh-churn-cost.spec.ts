// What one frame of steady mesh churn costs on the Mac's GPU, with the removal taken from each end
// of a mesh page: the 240 models of the mesh-churn-cost page, in a window that changes nothing, a
// window that replaces the oldest model each frame, and a window that replaces the newest one,
// three times each. A hole-closing removal moves every model after it in its page and uploads those
// bytes again; a removal at the page's end moves nothing. The difference between those two windows
// is the frame cost of the copy, which an offset allocator does not pay. It prints the medians of
// each side for D-247. It runs only with NULL3D_MESH_CHURN_COST set, in a quiet window on a
// computer with a GPU of its own:
// NULL3D_MESH_CHURN_COST=1 bun run test:browser -- mesh-churn-cost.spec.ts.
import { expect, test } from '@playwright/test';
import { COST_PAGE_MS, COST_TEST_MS, load, waitForQuietLoad } from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

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
	repack: Side[];
	tail: Side[];
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
	test(`a churn frame's hole-closing removal beside its tail removal, on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(COST_TEST_MS);
		await waitForQuietLoad();
		const loadBefore = load();
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto(`mesh-churn-cost.html?gpu=${gpu}&preset=low&prepass=off`);
		const result = await pageResult<ChurnResult>(page, COST_PAGE_MS);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		const idle = result.idle;
		const repack = result.repack;
		const tail = result.tail;
		console.log(
			[
				`${result.tier} on ${result.threads}, load ${loadBefore} before and ${load()} after`,
				line('idle', idle),
				line('replace oldest', repack),
				line('replace newest', tail),
				`a hole-closing frame costs ` +
					`${(median(repack.map((s) => s.renderWorkerMs)) - median(tail.map((s) => s.renderWorkerMs))).toFixed(3)} ms more of the render worker, ` +
					`${(sketch(repack) - sketch(tail)).toFixed(3)} ms more of the sketch worker's own code, ` +
					`and ${Math.round(median(repack.map((s) => s.uploadBytes)) - median(tail.map((s) => s.uploadBytes)))} more bytes of upload than a frame that cuts the page's end`,
			].join('\n'),
		);
	});
