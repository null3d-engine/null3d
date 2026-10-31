// Measures what the wind field costs the passes that read it, beside the steady field that a
// device without a grid computes: the same grove of grown oaks with the field's texture and with
// the analytic field, in turns. It splits the frame into its passes, so the main view, each shadow
// cascade and the motion view's second offset show apart where the device times passes. It runs
// only with NULL3D_WIND_READER_COST set, in a quiet window, on a computer with a GPU of its own:
// NULL3D_WIND_READER_COST=1 bun run test:browser -- wind-reader-cost.spec.ts.
// NULL3D_WIND_READER_PATHS names the paths, NULL3D_WIND_READER_PRESETS the presets and
// NULL3D_WIND_READER_VIEWS the views, each as a comma-separated list.
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

/** One figure that the page's measure published. */
interface Figure {
	median: number;
}

/** One page's result, as `vegetation-cost` publishes it. */
interface CostResult {
	error?: string;
	tier: string;
	preset: string;
	frames: number;
	gpuMs: Figure | null;
	gpuPassMs: { name: string; ms: Figure }[] | null;
	cpuMs: Figure | null;
	drawCalls: number;
}

const paths = (process.env.NULL3D_WIND_READER_PATHS ?? 'webgpu,webgl2').split(',');
const presets = (process.env.NULL3D_WIND_READER_PRESETS ?? 'low,medium').split(',');
const views = (process.env.NULL3D_WIND_READER_VIEWS ?? 'main,motion').split(',');
/** The rounds of each side, which alternate so a drift of the machine touches both alike. */
const ROUNDS = Number(process.env.NULL3D_WIND_READER_ROUNDS ?? '2');
const SECONDS = Number(process.env.NULL3D_WIND_READER_SECONDS ?? '5');

const ms = (value: number | null | undefined) =>
	value === null || value === undefined ? 'none' : value.toFixed(3);

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Loads the grove once and returns its result, at one path, preset and view with the field or the
 * steady field.
 */
async function runSide(
	page: import('@playwright/test').Page,
	gpu: string,
	preset: string,
	view: string,
	field: string,
): Promise<CostResult> {
	const motion = view === 'motion' ? '&motion=1' : '';
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto(
		`vegetation-cost.html?gpu=${gpu}&preset=${preset}&seconds=${SECONDS}&field=${field}${motion}`,
	);
	return pageResult<CostResult>(page, 300_000);
}

for (const gpu of paths) {
	for (const preset of presets) {
		for (const view of views) {
			test(`the wind readers on ${gpu} at ${preset}, ${view}`, async ({ page }) => {
				test.skip(
					!process.env.NULL3D_WIND_READER_COST,
					'set NULL3D_WIND_READER_COST to time the readers',
				);
				test.setTimeout(costTimeout(900_000));
				const loadBefore = await waitForQuiet();
				const grid: CostResult[] = [];
				const analytic: CostResult[] = [];
				for (let round = 0; round < ROUNDS; round++) {
					const order = round % 2 === 1 ? ['analytic', 'grid'] : ['grid', 'analytic'];
					for (const side of order) {
						const result = await runSide(page, gpu, preset, view, side);
						expect(result.error).toBeUndefined();
						(side === 'grid' ? grid : analytic).push(result);
					}
				}
				const load = loadNow();
				const gridFrame = median(grid.map((row) => row.gpuMs?.median ?? Number.NaN));
				const analyticFrame = median(analytic.map((row) => row.gpuMs?.median ?? Number.NaN));
				const names = new Set<string>();
				for (const row of [...grid, ...analytic])
					for (const pass of row.gpuPassMs ?? []) names.add(pass.name);
				const passMedian = (rows: CostResult[], name: string): number | null => {
					const values = rows
						.map((row) => row.gpuPassMs?.find((pass) => pass.name === name)?.ms.median)
						.filter((value): value is number => typeof value === 'number');
					return values.length ? median(values) : null;
				};
				console.log(
					[
						`${gpu} ${preset} ${view}: load ${loadBefore} before and ${load} after, rows ${grid.length}+${analytic.length}`,
						`  whole frame: field ${ms(gridFrame)} ms, analytic ${ms(analyticFrame)} ms, delta ${ms(gridFrame - analyticFrame)} ms`,
						...(grid[0]?.gpuPassMs
							? [...names].map((name) => {
									const fieldPass = passMedian(grid, name);
									const analyticPass = passMedian(analytic, name);
									return `  ${name}: field ${ms(fieldPass)} ms, analytic ${ms(analyticPass)} ms, delta ${ms((fieldPass ?? 0) - (analyticPass ?? 0))} ms`;
								})
							: ['  the device times no pass, so only the whole frame shows']),
						`  draw calls: ${grid[0]?.drawCalls ?? 'none'}`,
					].join('\n'),
				);
				expect(gridFrame).toBeGreaterThan(0);
				expect(analyticFrame).toBeGreaterThan(0);
			});
		}
	}
}
