// Measures the wind field's own cost on this computer: the fill pass, one solver step, and the
// steps at the pressure counts that the preset table names, for each grid shape. It prints each
// side's medians and the cost that a step's fixed part and its part per cell explain. It runs only
// with NULL3D_WIND_FIELD_COST set, in a quiet window, on a computer with a GPU of its own:
// NULL3D_WIND_FIELD_COST=1 bun run test:browser -- wind-field-cost.spec.ts.
// NULL3D_WIND_GPU names the paths, as a list such as webgpu,webgl2. NULL3D_WIND_SHAPES names the
// shapes, and NULL3D_WIND_POINTS the pressure steps.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** One side's medians, as the page publishes them. */
interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	refreshHz: number | null;
	computeMs: number | null;
	copiesMs: number | null;
	passes: { name: string; ms: number | null }[];
	threads: Record<string, number | null>;
}

interface FieldResult {
	error?: string;
	tier: string;
	shape: string;
	width: number;
	height: number;
	cells: number;
	points: number[];
	sides: Record<string, Side>;
	memory: {
		ready: boolean;
		gpuTextureBytes: number | null;
		gpuBufferBytes: number | null;
		wasmBytes: number | null;
		totalBytes: number | null;
	};
	fieldBytes: number;
	real: boolean;
	read: {
		ms?: number;
		frames?: number;
		width?: number;
		height?: number;
		error?: string;
	} | null;
	graph: string;
	failures: string[];
}

const gpus = (process.env.NULL3D_WIND_GPU ?? 'webgpu,compat,webgl2').split(',');
const shapes = (
	process.env.NULL3D_WIND_SHAPES ??
	'flat-32,flat-64,flat-128,flat-256,layered-4x64,layered-8x64,layered-4x128,layered-8x128,volume-32,volume-48x16x48,volume-64x24x64'
).split(',');
const points = process.env.NULL3D_WIND_POINTS ?? '1,8,16,24,40,80';

const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(3));
const gib = (value: number | null) =>
	value === null ? 'none' : (value / (1024 * 1024)).toFixed(1);

/**
 * The field's own cost in one side: WebGPU times each pass, which gives the field alone; WebGL2
 * times the frame as a whole, so its figure is the difference from the frame without the field.
 */
function fieldCost(tier: string, side: Side, off: Side): number {
	return tier === 'webgl2' ? (side.gpuMs ?? 0) - (off.gpuMs ?? 0) : (side.computeMs ?? 0);
}

/** The least-squares line through the cells and the cost of one step. */
function fit(xs: number[], ys: number[]): { intercept: number; slope: number } {
	const n = xs.length;
	const meanX = xs.reduce((a, b) => a + b, 0) / n;
	const meanY = ys.reduce((a, b) => a + b, 0) / n;
	let top = 0;
	let bottom = 0;
	for (let k = 0; k < n; k++) {
		top += ((xs[k] as number) - meanX) * ((ys[k] as number) - meanY);
		bottom += ((xs[k] as number) - meanX) ** 2;
	}
	const slope = bottom === 0 ? 0 : top / bottom;
	return { intercept: meanY - slope * meanX, slope };
}

for (const gpu of gpus) {
	test(`the wind field's cost on ${gpu}`, async ({ page }) => {
		test.skip(!process.env.NULL3D_WIND_FIELD_COST, 'set NULL3D_WIND_FIELD_COST to time the field');
		test.setTimeout(costTimeout(1_200_000));
		const loadBefore = await waitForQuiet();
		const rows: { shape: string; cells: number; result: FieldResult; load: string }[] = [];
		for (const shape of shapes) {
			await page.setViewportSize({ width: 640, height: 400 });
			await page.goto(
				`wind-field-cost.html?gpu=${gpu}&shape=${shape}&points=${points}&seconds=2&rounds=3`,
			);
			const result = await pageResult<FieldResult>(page, 300_000);
			const load = loadNow();
			rows.push({ shape, cells: result.cells, result, load });
			const sides = result.sides;
			const off = sides.off as Side;
			const frameDelta = (side: Side) => (side.gpuMs ?? 0) - (off.gpuMs ?? 0);
			const field = (side: Side) => fieldCost(result.tier, side, off);
			console.log(
				[
					`${result.tier} ${shape}: ${result.width} x ${result.height} texels, ${result.cells} cells, load ${loadBefore} before and ${load} after, refresh ${ms(off.refreshHz)} Hz`,
					`  baseline frame: GPU ${ms(off.gpuMs)} ms, interval ${ms(off.intervalMs)} ms, CPU ${ms(off.cpuMs)} ms`,
					...(result.real
						? [
								`  real solver, one cycle (22 runs): field ${ms(field(sides.real as Side))} ms, frame delta ${ms(frameDelta(sides.real as Side))} ms`,
							]
						: []),
					...result.points.map((count) => {
						const side = sides[`step-${count}`] as Side;
						const last = count === result.points[result.points.length - 1];
						const drag = last
							? `, with drag ${ms(field(sides[`step-${count}-drag`] as Side))} ms`
							: '';
						return `  ${count} chain steps: field ${ms(field(side))} ms (${ms(field(side) / count)} each), frame delta ${ms(frameDelta(side))} ms${drag}`;
					}),
					...(result.read
						? [
								result.read.error
									? `  read: ${result.read.error}`
									: `  read of ${result.read.width} x ${result.read.height}: ${ms(result.read.ms ?? null)} ms to answer, ${result.read.frames} frames late`,
							]
						: []),
					`  memory: textures ${gib(result.memory.gpuTextureBytes)} MiB, buffers ${gib(result.memory.gpuBufferBytes)} MiB, wasm ${gib(result.memory.wasmBytes)} MiB, total ${gib(result.memory.totalBytes)} MiB, field ${gib(result.fieldBytes)} MiB expected`,
					`  failures: ${result.failures.join('; ') || 'none'}`,
				].join('\n'),
			);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			expect(result.tier).toBe(gpu === 'compat' ? 'webgpu-compat' : gpu);
		}
		// One step's fixed cost and its cost per cell, from the flat shapes' step at one run: a flat
		// step reads four neighbours and a tiled volume step six.
		const flats = rows.filter((row) => row.shape.startsWith('flat'));
		const cells = flats.map((row) => row.cells);
		const one = flats.map((row) => {
			const sides = row.result.sides;
			return fieldCost(row.result.tier, sides['step-1'] as Side, sides.off as Side);
		});
		const { intercept, slope } = fit(cells, one);
		console.log(
			`${gpu}: one flat step = ${intercept.toFixed(3)} ms fixed + ${(slope * 1e6).toFixed(3)} ns per cell (${flats.length} shapes)`,
		);
	});
}
