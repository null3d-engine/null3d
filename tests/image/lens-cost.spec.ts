// What the lens kit's look costs, on each GPU path and preset: the wall of the lens cost sketch,
// timed with the look off and on, in turns (tests/pages/effect-cost.ts, ?effect=lens). The look
// draws the core's sharpening, vignette and grading, and the add-on's color fringes, streak, grain
// and speed blur. The 8-bit path draws no custom effect, so there its figure is the core's parts
// alone. It runs only with NULL3D_LENS_COST set, in a quiet window on a computer with a GPU of its
// own: NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts.
//
// The look's cost is a fraction of a millisecond, and the GPU clock steps at 0.065536 ms, so the
// page draws on a canvas four times the size of the one a 1080p window gives at this pixel ratio:
// 3840 by 2160 CSS at a pixel ratio of 2 is a 7680 by 4320 drawing buffer. Each side takes five
// rounds, with the sides in the opposite order on alternate rounds, and the line prints the lowest
// and highest difference between the sides' rounds, which is the cell's own spread.
//
// A mark is pixel work over the same screen area, and the preset does not change it, so each mark
// runs at one preset on each path: the highest that path allows. The whole look runs at every
// preset. NULL3D_LENS_PRESETS sets those presets, and NULL3D_LENS_GPUS the GPU paths.
// NULL3D_LENS_MARKS adds one run for each mark it names, with every other value at 0, so each
// mark's own cost shows. Each test waits for a quiet computer and prints the load beside its
// figures (tests/lib/effect-cost.ts).

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	type Side,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

const presets = (process.env.NULL3D_LENS_PRESETS ?? 'low,medium,high,ultra').split(',');
const paths = (process.env.NULL3D_LENS_GPUS ?? 'webgpu,compat,webgl2').split(',');
const marks = (process.env.NULL3D_LENS_MARKS ?? '').split(',').filter(Boolean);
/** The highest preset that each GPU path allows, which is where a mark's cost is measured. */
const HIGHEST_PRESET: Readonly<Record<string, string>> = {
	webgpu: 'ultra',
	compat: 'medium',
	webgl2: 'medium',
};
/** The rounds of each side, with the sides in the opposite order on alternate rounds. */
const ROUNDS = 5;
/** The canvas's CSS size, and the pixel ratio held for both sides. */
const SIZE = { width: 3840, height: 2160 } as const;
const PIXEL_RATIO = 2;

/** The lowest and highest of the rounds' differences between the sides, and how many rounds. */
function spread(off: Side, on: Side): string {
	const pairs = (off.gpuRoundsMs ?? []).map((value, index) => {
		const drawn = on.gpuRoundsMs?.[index];
		return drawn === undefined ? undefined : drawn - value;
	});
	const cpu = pairs.filter(
		(value): value is number => value !== undefined && Number.isFinite(value),
	);
	const fallback = (off.cpuRoundsMs ?? []).map((value, index) => {
		const drawn = on.cpuRoundsMs?.[index];
		return drawn === undefined ? undefined : drawn - value;
	});
	const values =
		cpu.length > 0
			? cpu
			: fallback.filter((value): value is number => value !== undefined && Number.isFinite(value));
	if (values.length === 0) return 'spread: none';
	const unit = cpu.length > 0 ? 'GPU' : 'CPU';
	const low = Math.min(...values);
	const high = Math.max(...values);
	return `spread: ${unit} ${low.toFixed(3)} to ${high.toFixed(3)} over ${values.length} rounds`;
}

/** Runs one look or mark on one path and preset, and prints its sides with the cell's spread. */
async function timeLook(
	page: Page,
	{ gpu, preset, mark }: { gpu: string; preset: string; mark?: string },
): Promise<void> {
	test.setTimeout(costTimeout(400_000));
	const loadBefore = await waitForQuiet();
	await page.setViewportSize(SIZE);
	const look = mark === undefined ? '' : `&look=${mark}`;
	await page.goto(
		`effect-cost.html?effect=lens&gpu=${gpu}&preset=${preset}&scale=1&pixel-ratio=${PIXEL_RATIO}&rounds=${ROUNDS}${look}`,
	);
	const result = await pageResult<CostResult>(page, 300_000);
	expect(result.error).toBeUndefined();
	const named = mark === undefined ? '' : `, look ${mark}`;
	console.log(
		[
			`LENSCOST ${result.tier} at ${preset}${named}, load ${loadBefore} before and ${loadNow()} after`,
			sideLine('off', result.off, 3),
			sideLine('on', result.on, 3),
			spread(result.off, result.on),
		].join('\n'),
	);
	expect(result.failures).toEqual([]);
}

for (const gpu of paths)
	for (const preset of presets)
		test(`lens kit on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_LENS_COST, 'set NULL3D_LENS_COST to time the lens kit');
			await timeLook(page, { gpu, preset });
		});

for (const mark of marks)
	for (const gpu of paths) {
		const preset = HIGHEST_PRESET[gpu] ?? 'medium';
		test(`lens kit's ${mark} on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_LENS_COST, 'set NULL3D_LENS_COST to time the lens kit');
			await timeLook(page, { gpu, preset, mark });
		});
	}
