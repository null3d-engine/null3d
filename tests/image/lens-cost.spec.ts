// What the lens kit's look costs, on each GPU path and preset: the lens cost sketch, timed with
// the look off and on, in turns (tests/pages/effect-cost.ts, ?effect=lens). The look draws the
// core's sharpening, vignette and grading, and the add-on's color fringes, streak, grain and speed
// blur. The 8-bit path draws no custom effect, so there its figure is the core's parts alone. It
// runs only with NULL3D_LENS_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts.
//
// A full-screen pass of a few taps is a fraction of a millisecond, and the scene's own frame time
// moves by more than that between rounds, so the page clears the scene to the background and the
// the bars that feed bloom (?clear) and draws the marks' effect eight times in every frame
// (?repeat=8). The cell divides what it measures by the repeat count. Eight is the most effects
// that the engine runs at once.
//
// The cell reads the effect's own passes from the per-pass GPU timer where the device times them,
// and the whole frame's difference where it does not. Each side takes eight rounds of a second, with
// the sides in the opposite order on alternate rounds, so a clock that drifts during a cell moves
// both sides alike. The line prints the passes of both sides, each round's difference and the
// timer's step, so a figure that the run cannot resolve says so.
//
// The canvas is 3840 by 2160 CSS pixels at a pixel ratio of 2, a 7680 by 4320 drawing buffer, at a
// render scale of 1 with the governor off. NULL3D_LENS_PRESETS sets the presets, and NULL3D_LENS_GPUS
// the GPU paths. NULL3D_LENS_MARKS adds one run for each mark it names, with every other value at 0.
// Each test waits for a quiet computer and prints the load beside its figures (tests/lib/effect-cost.ts).

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
/** The marks that draw the add-on's effect, which the page repeats. */
const EFFECT_MARKS = new Set(['aberration', 'streak', 'grain', 'speed']);
/** How many times the page draws the effect in each frame. */
const REPEAT = 8;
/** The rounds of each side, and the seconds of each turn. */
const ROUNDS = 8;
const SECONDS = 1;
/** The canvas's CSS size, and the pixel ratio held for both sides. */
const SIZE = { width: 3840, height: 2160 } as const;
const PIXEL_RATIO = 2;

/** The middle of some numbers, or null without any. */
function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The parts of a side's frame, with their GPU time where the device times passes. */
const passesLine = (side: Side) =>
	(side.passes ?? [])
		.map((pass) => `${pass.name} ${pass.ms === null ? 'none' : pass.ms.toFixed(3)}`)
		.join(', ') || 'none';

/** One round's value of each named part, or undefined where that round did not report it. */
function partRound(side: Side, name: string, round: number): number | undefined {
	const value = side.passRoundsMs?.[name]?.[round];
	return Number.isFinite(value) ? value : undefined;
}

/** The number of rounds that both sides reported. */
function roundCount(off: Side, on: Side): number {
	return Math.min(off.gpuRoundsMs?.length ?? 0, on.gpuRoundsMs?.length ?? 0);
}

/** One reading of a cell: the rounds' values, divided by the repeat count, with their range. */
interface Reading {
	ms: number | null;
	low: number | null;
	high: number | null;
	source: string;
	rounds: number;
}

/** One reading from each round's value, divided by the repeat count. */
function reading(source: string, values: number[], repeat: number): Reading {
	const scaled = values.filter(Number.isFinite).map((value) => value / repeat);
	if (scaled.length === 0) return { ms: null, low: null, high: null, source, rounds: 0 };
	return {
		ms: median(scaled),
		low: Math.min(...scaled),
		high: Math.max(...scaled),
		source,
		rounds: scaled.length,
	};
}

/**
 * The cell's readings. The whole frame's difference holds every part of the look, so it is the cell
 * for a look that draws the core's parts and the effect. The passes that the on side adds hold the
 * effect's own work alone, which is the cell for one mark. A device that times no pass, as WebGL2
 * does, gives the whole frame's difference only.
 */
function readings(off: Side, on: Side, repeat: number): { own: Reading; whole: Reading } {
	const whole: number[] = [];
	const offNames = new Set((off.passes ?? []).map((pass) => pass.name));
	const names = (on.passes ?? [])
		.map((pass) => pass.name)
		.filter((name) => name !== 'between passes');
	const added = names.filter((name) => !offNames.has(name));
	const own: number[] = [];
	for (let round = 0; round < roundCount(off, on); round++) {
		const drawn = on.gpuRoundsMs?.[round];
		const plain = off.gpuRoundsMs?.[round];
		if (drawn !== undefined && plain !== undefined) whole.push(drawn - plain);
		if (added.length === 0) continue;
		let sum = 0;
		for (const name of added) {
			const part = partRound(on, name, round);
			if (part === undefined) {
				sum = Number.NaN;
				break;
			}
			sum += part;
		}
		own.push(sum);
	}
	return {
		own: reading(
			added.length > 0 ? `passes ${added.join(', ')}` : 'no pass of its own',
			own,
			repeat,
		),
		whole: reading('whole frame', whole, repeat),
	};
}

/** Runs one look or mark on one path and preset, and prints its sides with the cell's range. */
async function timeLook(
	page: Page,
	{ gpu, preset, mark }: { gpu: string; preset: string; mark?: string },
): Promise<void> {
	test.setTimeout(costTimeout(500_000));
	const loadBefore = await waitForQuiet();
	await page.setViewportSize(SIZE);
	// The whole look draws once, since the repeats draw the marks in place of the kit's effect. A
	// mark draws eight times, so its own fraction of a millisecond rises above the run's variation.
	const repeat = mark !== undefined && EFFECT_MARKS.has(mark) ? REPEAT : 1;
	const look = mark === undefined ? '' : `&look=${mark}`;
	await page.goto(
		`effect-cost.html?effect=lens&gpu=${gpu}&preset=${preset}&scale=1&pixel-ratio=${PIXEL_RATIO}&rounds=${ROUNDS}&seconds=${SECONDS}&clear&repeat=${repeat}${look}`,
	);
	const result = await pageResult<CostResult & { repeat: number }>(page, 400_000);
	expect(result.error).toBeUndefined();
	const named = mark === undefined ? '' : `, look ${mark}`;
	const step = result.on.stepMs ?? result.off.stepMs ?? null;
	const read = readings(result.off, result.on, repeat);
	// The whole look holds the core's parts, which draw inside passes that both sides draw, so its
	// cell is the frame. A mark draws only its own effect, so the passes that side adds are its cell
	// where the device times them.
	const chosen = mark === undefined || read.own.ms === null ? read.whole : read.own;
	const printing = (value: Reading) =>
		value.ms === null
			? `${value.source}: none`
			: `${value.source}: ${value.ms.toFixed(3)} ms, range ${(value.low as number).toFixed(3)} to ${(value.high as number).toFixed(3)} ms over ${value.rounds} rounds`;
	console.log(
		[
			`LENSCOST ${result.tier} at ${preset}${named}, repeat ${repeat}, ${SECONDS} s turns, ${ROUNDS} rounds, step ${step === null ? 'none' : step.toFixed(6)} ms, load ${loadBefore} before and ${loadNow()} after`,
			`lens off passes: ${passesLine(result.off)}`,
			`lens on passes: ${passesLine(result.on)}`,
			sideLine('off', result.off, 3),
			sideLine('on', result.on, 3),
			`own: ${printing(read.own)}`,
			`whole: ${printing(read.whole)}`,
			`cell: ${printing(chosen)}`,
		].join('\n'),
	);
	expect(result.failures).toEqual([]);
	// A page whose frames failed draws no timed side, and a run that read nothing must not pass as
	// a cost of zero.
	expect(chosen.rounds, `the ${mark ?? 'whole look'} cell read no round`).toBeGreaterThan(0);
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
