// What the lens kit's look costs, on each GPU path and preset: the wall of the lens cost sketch,
// timed with the look off and on, in turns (tests/pages/effect-cost.ts, ?effect=lens). The look
// draws the core's sharpening, vignette and grading, and the add-on's color fringes, streak, grain
// and speed blur. The 8-bit path draws no custom effect, so there its figure is the core's parts
// alone. It runs only with NULL3D_LENS_COST set, in a quiet window on a computer with a GPU of its
// own: NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts.
//
// The look's own effect is a fraction of a millisecond, below what the scene's frame-to-frame
// variation can resolve, so the page draws that effect eight times in every frame and divides what
// it measures by eight. The engine runs at most eight effects at once, which bounds the repeat.
// Each side measures a quarter second at a time and the sides trade places every turn, thirty-two
// rounds, so a clock that drifts during a cell moves both sides alike. The GPU timer samples one
// frame in eleven, so a turn holds a few samples rather than one.
//
// The line reads the effect's own passes from the per-pass GPU timer where the device times passes,
// which is where the step between the timer's values is 0.065536 ms on this Mac. A path that times
// no pass, as WebGL2 does, reports the whole frame's span instead, and the line says that this is
// not the look's cost. The engine times seven passes a frame, and bloom draws fifteen, so while
// bloom is on the look's passes fall past the timed slots. The three marks that draw no streak
// therefore run without bloom, which leaves the look's passes inside the timed slots; the streak
// and the whole look keep bloom and read the last timed pass's growth, which carries the passes
// after it.
//
// The grade and the vignette run inside the final pass, so their runs take no repeat, and their
// lines show the pass's part with each on and off beside the timer's step. The sharpening draws a
// second final pass, which the pass list shows. The whole look takes the repeat, with its core
// parts drawn once, so a repeated cell holds the marks' work plus a share of the core's.
//
// The page draws on a canvas four times the size of the one a 1080p window gives at this pixel
// ratio: 3840 by 2160 CSS at a pixel ratio of 2 is a 7680 by 4320 drawing buffer.
// NULL3D_LENS_PRESETS sets the presets, and NULL3D_LENS_GPUS the GPU paths. NULL3D_LENS_MARKS adds
// one run for each mark it names, with every other value at 0, so each mark's own cost shows. Each
// test waits for a quiet computer and prints the load beside its figures (tests/lib/effect-cost.ts).

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
/** The marks that draw no streak, so their pages leave bloom out and keep the frame's passes few. */
const NO_BLOOM = new Set(['aberration', 'grain', 'speed']);
/** How many times the page draws the effect in each frame. */
const REPEAT = 8;
/** The rounds of each side, and the seconds of each turn. */
const ROUNDS = 32;
const SECONDS = 0.25;
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

/** The highest round that either side reported. */
function roundCount(off: Side, on: Side): number {
	return Math.max(off.gpuRoundsMs?.length ?? 0, on.gpuRoundsMs?.length ?? 0);
}

/**
 * The cell: each round's reading of the effect's own part, divided by the repeat count, with the
 * lowest and highest round and where the reading came from.
 */
function cell(
	off: Side,
	on: Side,
	repeat: number,
): { ms: number | null; low: number | null; high: number | null; source: string; rounds: number } {
	const onNames = (on.passes ?? []).map((pass) => pass.name);
	const offNames = new Set((off.passes ?? []).map((pass) => pass.name));
	const added = onNames.filter((name) => !offNames.has(name));
	const between =
		on.passRoundsMs?.['between passes'] !== undefined &&
		off.passRoundsMs?.['between passes'] !== undefined;
	const shared = onNames.filter(
		(name) => name !== 'between passes' && name !== 'copies' && offNames.has(name),
	);
	/** A render pass's place in the frame, from its name, or -1 for another part. */
	const order = (name: string) => {
		const match = /^render (\d+)$/.exec(name);
		return match === null ? -1 : Number(match[1]);
	};
	/** How far a shared pass's median time moved from off to on. */
	const growth = (name: string) => {
		const drawn = on.passes?.find((pass) => pass.name === name)?.ms;
		const plain = off.passes?.find((pass) => pass.name === name)?.ms;
		return drawn === null || drawn === undefined || plain === null || plain === undefined
			? null
			: drawn - plain;
	};
	// A pass past the seven that the engine times joins the last timed pass's slot, so the pass that
	// grew carries the effect's work where none of the look's own passes is named on its own. A run
	// with no repeat reads the last render pass, which is the final pass.
	const grown = shared
		.map((name) => ({ name, ms: growth(name) }))
		.filter((pass): pass is { name: string; ms: number } => pass.ms !== null)
		.sort((a, b) => b.ms - a.ms)[0]?.name;
	const lastRender = [...shared].sort((a, b) => order(b) - order(a))[0];
	const target = repeat > 1 ? (grown ?? lastRender) : (lastRender ?? grown);
	const source =
		added.length > 0
			? `passes ${added.join(', ')}${between ? ' and the tail' : ''}`
			: target !== undefined
				? `pass ${target}`
				: between
					? 'between passes'
					: 'whole frame';
	/** The round's reading of the part that the source names, before the repeat count divides it. */
	const valueAt = (round: number): number | undefined => {
		if (added.length > 0) {
			let sum = 0;
			for (const name of added) {
				const part = partRound(on, name, round);
				if (part === undefined) return undefined;
				sum += part;
			}
			// A pass that the timer does not time by itself lands in the tail, so the tail's growth
			// is part of the effect's work too.
			if (between) {
				const drawn = partRound(on, 'between passes', round);
				const plain = partRound(off, 'between passes', round);
				if (drawn === undefined || plain === undefined) return undefined;
				sum += drawn - plain;
			}
			return sum;
		}
		const [drawn, plain] =
			target !== undefined
				? [partRound(on, target, round), partRound(off, target, round)]
				: between
					? [partRound(on, 'between passes', round), partRound(off, 'between passes', round)]
					: [on.gpuRoundsMs?.[round], off.gpuRoundsMs?.[round]];
		return drawn === undefined || plain === undefined ? undefined : drawn - plain;
	};
	const rounds = roundCount(off, on);
	const values: number[] = [];
	for (let round = 0; round < rounds; round++) {
		const value = valueAt(round);
		if (value !== undefined && Number.isFinite(value)) values.push(value / repeat);
	}
	if (values.length === 0) return { ms: null, low: null, high: null, source, rounds: 0 };
	return {
		ms: median(values),
		low: Math.min(...values),
		high: Math.max(...values),
		source,
		rounds: values.length,
	};
}

/** The part that both sides draw last, and how far its median time moved from off to on. */
function lastSharedDelta(off: Side, on: Side): { name: string; ms: number } | null {
	const plain = new Map((off.passes ?? []).map((pass) => [pass.name, pass.ms]));
	for (const pass of [...(on.passes ?? [])].reverse()) {
		if (pass.name === 'between passes') continue;
		if (pass.ms === null) continue;
		const before = plain.get(pass.name);
		if (before === undefined || before === null) continue;
		return { name: pass.name, ms: pass.ms - before };
	}
	return null;
}

/** Runs one look or mark on one path and preset, and prints its sides with the cell's range. */
async function timeLook(
	page: Page,
	{ gpu, preset, mark }: { gpu: string; preset: string; mark?: string },
): Promise<void> {
	test.setTimeout(costTimeout(500_000));
	const loadBefore = await waitForQuiet();
	await page.setViewportSize(SIZE);
	const repeat = mark === undefined || EFFECT_MARKS.has(mark) ? REPEAT : 1;
	const look = mark === undefined ? '' : `&look=${mark}`;
	const bloom = mark !== undefined && NO_BLOOM.has(mark) ? '&bloom=off' : '';
	await page.goto(
		`effect-cost.html?effect=lens&gpu=${gpu}&preset=${preset}&scale=1&pixel-ratio=${PIXEL_RATIO}&rounds=${ROUNDS}&seconds=${SECONDS}&repeat=${repeat}${look}${bloom}`,
	);
	const result = await pageResult<CostResult & { repeat: number; seconds: number | null }>(
		page,
		400_000,
	);
	expect(result.error).toBeUndefined();
	const named = mark === undefined ? '' : `, look ${mark}`;
	const step = result.on.stepMs ?? result.off.stepMs ?? null;
	const read = cell(result.off, result.on, repeat);
	const shared = lastSharedDelta(result.off, result.on);
	const timesPasses = (result.off.passes ?? []).length > 0;
	const reading =
		read.ms === null
			? 'none'
			: `${read.ms.toFixed(3)} ms from ${read.source} over ${read.rounds} rounds, range ${(
					read.low as number
				).toFixed(3)} to ${(read.high as number).toFixed(3)}`;
	const sharedLine =
		shared === null
			? 'no shared pass'
			: `shared pass ${shared.name} moved ${shared.ms.toFixed(3)} ms${
					step === null ? '' : `, against a step of ${step.toFixed(6)} ms`
				}`;
	console.log(
		[
			`LENSCOST ${result.tier} at ${preset}${named}, repeat ${repeat}, ${SECONDS} s turns, ${ROUNDS} rounds, step ${step === null ? 'none' : step.toFixed(6)} ms, load ${loadBefore} before and ${loadNow()} after`,
			`lens off passes: ${passesLine(result.off)}`,
			`lens on passes: ${passesLine(result.on)}`,
			sideLine('off', result.off, 3),
			sideLine('on', result.on, 3),
			sharedLine,
			`cell: ${reading}${timesPasses ? '' : ", and this path times the whole frame, so it is not the look's cost"}`,
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
