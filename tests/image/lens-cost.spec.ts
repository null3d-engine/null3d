// What the lens kit's look costs, on each GPU path and preset: the lens cost sketch, timed with
// the look off and on, in turns (tests/pages/effect-cost.ts, ?effect=lens). The look draws the
// core's sharpening, vignette and grading, and the add-on's color fringes, streak, grain and speed
// blur. It runs only with NULL3D_LENS_COST set, in a quiet window on a computer with a GPU of its
// own: NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts.
//
// A full-screen pass of a few taps is a fraction of a millisecond, and the scene's own frame time
// moves by more than that between rounds, so the page clears the scene to the background and the
// bars that feed bloom (?clear) and draws the marks' effect eight times in every frame (?repeat=8).
// The cell divides what it measures by the repeat count. Eight is the most effects that the engine
// runs at once. A core mark draws in the final pass and needs no bloom, so its frame leaves bloom
// out (?bloom=off).
//
// The cell reads the passes that grew from the per-pass GPU timer where the device times passes, and
// the whole frame's difference where it does not. An effect's work joins a pass of the frame, or
// adds one, so those passes hold the mark alone and leave the frame's other movement out. Each side
// takes rounds of a turn, with the sides in the opposite order on alternate rounds, so a clock that
// drifts during a cell moves both sides alike. The line prints the passes, the draws and rounds of
// both sides, the cell's rounds and the timer's step, so a figure that the run cannot resolve says
// so.
//
// The canvas is 3840 by 2160 CSS pixels at a pixel ratio of 2, a 7680 by 4320 drawing buffer, at a
// render scale of 1 with the governor off. NULL3D_LENS_SIZE sets the canvas as WIDTHxHEIGHT,
// NULL3D_LENS_PIXEL_RATIO its ratio and NULL3D_LENS_SCALE the render scale: a smaller canvas keeps a
// heavy preset's look-on frame inside the display interval, where the whole-frame timer still reads
// the look, and a figure taken there is reported with its own canvas. NULL3D_LENS_PRESETS sets the
// presets, and NULL3D_LENS_GPUS the GPU paths. NULL3D_LENS_MARKS adds one run for each mark it names,
// with every other value at 0, at every preset that its path allows. NULL3D_LENS_ROUNDS and
// NULL3D_LENS_SECONDS set the sample, and NULL3D_LENS_BATCHES the batches of each cell: the cheapest
// batch is reported, because a loaded
// machine only adds time, and the batches' spread says how finely the load allows a cell to resolve.
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
/**
 * The presets that each GPU path allows, from the lightest to the heaviest. The chooser caps
 * compatibility mode and WebGL2 at Medium, so a heavier preset there draws Medium's settings.
 */
const PATH_PRESETS: Readonly<Record<string, readonly string[]>> = {
	webgpu: ['low', 'medium', 'high', 'ultra'],
	compat: ['low', 'medium'],
	webgl2: ['low', 'medium'],
};
/** The marks that draw the add-on's effect, which the page repeats. */
const EFFECT_MARKS = new Set(['aberration', 'streak', 'grain', 'speed']);
/** How many times the page draws the effect in each frame. */
const REPEAT = 8;
/** The rounds of each side, and the seconds of each turn. */
const ROUNDS = Number(process.env.NULL3D_LENS_ROUNDS ?? 8);
const SECONDS = Number(process.env.NULL3D_LENS_SECONDS ?? 1);
/**
 * How many times a cell runs. A loaded machine only adds time to a frame, so the cheapest batch is
 * the closest to the code's own cost, and the batches' spread says how finely the load allows the
 * cell to resolve.
 */
const BATCHES = Number(process.env.NULL3D_LENS_BATCHES ?? 1);
if (!(Number.isSafeInteger(BATCHES) && BATCHES >= 1))
	throw new Error(`the lens cost takes a whole number of batches from 1, not ${BATCHES}`);
/**
 * The canvas's CSS size, its pixel ratio and the render scale. The defaults draw 33 megapixels. A
 * smaller canvas keeps a heavy preset's frame inside the display interval, where the whole-frame
 * timer still reads the look rather than the queue; a figure taken there is not the 33-megapixel
 * one and is reported with its own canvas.
 */
function canvasSize(value: string): { width: number; height: number } {
	const match = /^(\d+)x(\d+)$/.exec(value);
	if (match === null) throw new Error(`the lens cost takes a canvas as WIDTHxHEIGHT, not ${value}`);
	return { width: Number(match[1]), height: Number(match[2]) };
}
const SIZE = canvasSize(process.env.NULL3D_LENS_SIZE ?? '3840x2160');
const PIXEL_RATIO = Number(process.env.NULL3D_LENS_PIXEL_RATIO ?? 2);
const RENDER_SCALE = Number(process.env.NULL3D_LENS_SCALE ?? 1);
if (!(PIXEL_RATIO >= 0.5))
	throw new Error(`the lens cost takes a pixel ratio from 0.5, not ${PIXEL_RATIO}`);
if (!(RENDER_SCALE >= 0.25 && RENDER_SCALE <= 1))
	throw new Error(`the lens cost takes a render scale from 0.25 to 1, not ${RENDER_SCALE}`);

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
	/** Each round's value, in the order the rounds ran. */
	values: number[];
}

/** One reading from each round's value, divided by the repeat count. */
function reading(source: string, values: number[], repeat: number): Reading {
	const scaled = values.filter(Number.isFinite).map((value) => value / repeat);
	if (scaled.length === 0)
		return { ms: null, low: null, high: null, source, rounds: 0, values: [] };
	return {
		ms: median(scaled),
		low: Math.min(...scaled),
		high: Math.max(...scaled),
		source,
		rounds: scaled.length,
		values: scaled,
	};
}

/**
 * The passes whose time grew, with each round's difference between the sides. A mark's work joins a
 * pass of the frame, or adds one, and a repeat draws that many passes when they do not join, so the
 * mark's cell is the sum of the passes that rose in every round. Where none rose in every round, the
 * single pass that rose in most rounds is the clearest the frame allows. A pass that the on side
 * alone draws counts from zero. Null when no pass rose in most rounds, so a mark that the frame's
 * movement hides gives no reading rather than a cost.
 */
function ownPasses(off: Side, on: Side): { names: string[]; values: number[] } | null {
	const offNames = new Set((off.passes ?? []).map((pass) => pass.name));
	const names = new Set([...(off.passes ?? []), ...(on.passes ?? [])].map((pass) => pass.name));
	const spreads = new Map<string, number[]>();
	for (const name of names) {
		if (name === 'between passes') continue;
		const values: number[] = [];
		let complete = true;
		for (let round = 0; round < roundCount(off, on); round++) {
			const drawn = partRound(on, name, round);
			const plain = offNames.has(name) ? partRound(off, name, round) : 0;
			if (drawn === undefined || plain === undefined) {
				complete = false;
				break;
			}
			values.push(drawn - plain);
		}
		if (complete && values.length > 0) spreads.set(name, values);
	}
	const risen = [...spreads].filter(([, values]) => values.every((value) => value > 0));
	const chosen =
		risen.length > 0
			? risen
			: (() => {
					let best: [string, number[]] | null = null;
					let bestMedian = 0;
					for (const [name, values] of spreads) {
						const middle = median(values);
						const positives = values.filter((value) => value > 0).length;
						if (middle === null || middle <= bestMedian || positives * 2 <= values.length) continue;
						best = [name, values];
						bestMedian = middle;
					}
					return best === null ? [] : [best];
				})();
	if (chosen.length === 0) return null;
	const first = chosen[0];
	if (first === undefined) return null;
	const values = first[1].map((_, round) =>
		chosen.reduce((sum, [, spread]) => sum + (spread[round] as number), 0),
	);
	return { names: chosen.map(([name]) => name), values };
}

/**
 * The cell's readings. The whole frame's difference holds every part of the look, so it is the cell
 * for a look that draws the core's parts and the effect. The passes that grew hold the mark's own
 * work alone, which is the cell for one mark. A device that times no pass, as WebGL2 does, gives the
 * whole frame's difference only.
 */
function readings(off: Side, on: Side, repeat: number): { own: Reading; whole: Reading } {
	const whole: number[] = [];
	for (let round = 0; round < roundCount(off, on); round++) {
		const drawn = on.gpuRoundsMs?.[round];
		const plain = off.gpuRoundsMs?.[round];
		if (drawn !== undefined && plain !== undefined) whole.push(drawn - plain);
	}
	const own = ownPasses(off, on);
	return {
		own: own
			? reading(`passes ${own.names.join(', ')}`, own.values, repeat)
			: { ms: null, low: null, high: null, source: 'no pass of its own', rounds: 0, values: [] },
		whole: reading('whole frame', whole, repeat),
	};
}

/** Runs one look or mark on one path and preset, and prints its sides with the cell's range. */
async function timeLook(
	page: Page,
	{ gpu, preset, mark }: { gpu: string; preset: string; mark?: string },
): Promise<void> {
	test.setTimeout(costTimeout(500_000 * BATCHES));
	const loadBefore = await waitForQuiet();
	await page.setViewportSize(SIZE);
	// The whole look draws once, since the repeats draw the marks in place of the kit's effect. A
	// mark draws eight times, so its own fraction of a millisecond rises above the run's variation.
	const repeat = mark !== undefined && EFFECT_MARKS.has(mark) ? REPEAT : 1;
	// A core mark draws in the final pass and does not read bloom's chain, so bloom is left out of
	// its frame: the chain adds work and movement that the mark's own pass does not need.
	const bloomOff = mark !== undefined && !EFFECT_MARKS.has(mark) ? '&bloom=off' : '';
	// WebGL2 times no pass, so its cell reads the whole frame. The preset's bounce light is scene
	// work that the cleared frame does not use, and its passes move more than the look, so it stays
	// out there. A path that times passes keeps it, so its frame holds the preset's work.
	const bounceOff = gpu === 'webgl2' ? '&bounce=off' : '';
	const look = mark === undefined ? '' : `&look=${mark}`;
	const named = mark === undefined ? '' : `, look ${mark}`;
	const printing = (value: Reading) =>
		value.ms === null
			? `${value.source}: none`
			: `${value.source}: ${value.ms.toFixed(3)} ms, range ${(value.low as number).toFixed(3)} to ${(value.high as number).toFixed(3)} ms over ${value.rounds} rounds`;
	const roundsLine = (value: Reading) =>
		`rounds: ${value.values.map((round) => round.toFixed(3)).join(', ')}`;
	const gpuRounds = (side: Side) =>
		`${(side.gpuRoundsMs ?? []).map((ms) => ms.toFixed(3)).join(', ') || 'none'}`;
	const taken: Reading[] = [];
	for (let batch = 1; batch <= BATCHES; batch++) {
		await page.goto(
			`effect-cost.html?effect=lens&gpu=${gpu}&preset=${preset}&scale=${RENDER_SCALE}&pixel-ratio=${PIXEL_RATIO}&rounds=${ROUNDS}&seconds=${SECONDS}&clear&repeat=${repeat}${bloomOff}${bounceOff}${look}`,
		);
		const result = await pageResult<CostResult & { repeat: number }>(page, 400_000);
		expect(result.error).toBeUndefined();
		const step = result.on.stepMs ?? result.off.stepMs ?? null;
		const read = readings(result.off, result.on, repeat);
		// The whole look holds the core's parts, which draw inside passes that both sides draw, so its
		// cell is the frame. A mark's own work lands in one pass, which is its cell where the device
		// times passes.
		const chosen = mark === undefined || read.own.ms === null ? read.whole : read.own;
		taken.push(chosen);
		console.log(
			[
				`LENSCOST ${result.tier} at ${preset}${named}, batch ${batch} of ${BATCHES}, repeat ${repeat}, ${SECONDS} s turns, ${ROUNDS} rounds, canvas ${SIZE.width}x${SIZE.height} at ratio ${PIXEL_RATIO} and scale ${RENDER_SCALE}, step ${step === null ? 'none' : step.toFixed(6)} ms, load ${loadBefore} before and ${loadNow()} after`,
				`lens off passes: ${passesLine(result.off)}`,
				`lens on passes: ${passesLine(result.on)}`,
				sideLine('off', result.off, 3),
				sideLine('on', result.on, 3),
				`draws: ${result.off.draws ?? 'none'} off, ${result.on.draws ?? 'none'} on`,
				`gpu rounds: ${gpuRounds(result.off)} off, ${gpuRounds(result.on)} on`,
				`own: ${printing(read.own)}`,
				`whole: ${printing(read.whole)}`,
				`cell: ${printing(chosen)}`,
				roundsLine(chosen),
			].join('\n'),
		);
		expect(result.failures).toEqual([]);
		// A page whose frames failed draws no timed side, and a run that read nothing must not pass as
		// a cost of zero.
		expect(chosen.rounds, `the ${mark ?? 'whole look'} cell read no round`).toBeGreaterThan(0);
	}
	// The cheapest batch is the closest to the code's own cost, since the load only adds time.
	const best = taken.reduce((low, value) =>
		value.ms !== null && (low.ms === null || value.ms < low.ms) ? value : low,
	);
	const medians = taken.map((value) => (value.ms === null ? 'none' : value.ms.toFixed(3)));
	console.log(
		`LENSCOST best ${gpu} at ${preset}${named}, canvas ${SIZE.width}x${SIZE.height} at ratio ${PIXEL_RATIO} and scale ${RENDER_SCALE}: ${printing(best)}, from ${BATCHES} batch${BATCHES === 1 ? '' : 'es'} (${medians.join(', ')} ms)`,
	);
}

for (const gpu of paths)
	for (const preset of presets)
		test(`lens kit on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_LENS_COST, 'set NULL3D_LENS_COST to time the lens kit');
			await timeLook(page, { gpu, preset });
		});

for (const mark of marks)
	for (const gpu of paths)
		for (const preset of PATH_PRESETS[gpu] ?? ['medium'])
			test(`lens kit's ${mark} on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
				test.skip(!process.env.NULL3D_LENS_COST, 'set NULL3D_LENS_COST to time the lens kit');
				await timeLook(page, { gpu, preset, mark });
			});
