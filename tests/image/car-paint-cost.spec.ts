// What the car paint costs, on each GPU path and preset: the panel of tests/pages/
// car-paint-cost-sketch.ts, timed with a plain clear-coated metal and with the paint in turns. The
// paint adds the metal flakes, the panel seams and the carbon weave, whose highlight the engine's
// stretched lobe lights. The page draws at a fixed render scale with the frame-budget governor off,
// and the sides take the opposite order on alternate rounds, so a moving scale or a drifting clock
// cannot pass for the paint's own cost. It runs only with NULL3D_PAINT_COST set, in a quiet window
// on a computer with a GPU of its own:
// NULL3D_PAINT_COST=1 bun run test:browser -- car-paint-cost.spec.ts --workers=1.
// NULL3D_PAINT_PRESETS sets the presets, as a list, and NULL3D_PAINT_VARIANT picks the painted
// side's parts: full, flakes, body, loop or loop-0. Each test waits for a quiet computer and prints
// the load beside its figures, with each side's rounds and each round's difference, so the paint's
// cost shows apart from the run's own variation (tests/lib/effect-cost.ts).
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

const presets = (process.env.NULL3D_PAINT_PRESETS ?? 'low,medium,high,ultra').split(',');
/** The painted side's parts, which the page's own list of names holds. */
const variant = process.env.NULL3D_PAINT_VARIANT ?? 'full';
/** The rounds of each side, the seconds of each turn and the play before them. */
const ROUNDS = 8;
const SECONDS = 1;
const WARM_UP = 4;

/** A side's parts of the frame with their GPU time, where the device times its passes. */
function passesLine(side: Side): string {
	return (
		(side.passes ?? [])
			.map((pass) => `${pass.name} ${pass.ms === null ? 'none' : pass.ms.toFixed(3)}`)
			.join(', ') || 'none'
	);
}

/** A side's GPU time in each round, so the run's own spread shows beside its median. */
function roundsLine(name: string, side: Side): string {
	const rounds = side.gpuRoundsMs ?? [];
	const values = rounds.map((ms) => ms.toFixed(3)).join(', ');
	return `${name} rounds: ${rounds.length === 0 ? 'none' : values}`;
}

/**
 * Each round's difference between the painted and the plain series, paired where both report the
 * round. A round measures its two sides one after the other, so a clock that drifts during a round
 * moves both alike.
 */
function roundDifferences(plain?: readonly number[], painted?: readonly number[]): number[] {
	const pairs = Math.min(plain?.length ?? 0, painted?.length ?? 0);
	const differences: number[] = [];
	for (let round = 0; round < pairs; round++) {
		const was = plain?.[round];
		const now = painted?.[round];
		if (was === undefined || now === undefined) continue;
		differences.push(now - was);
	}
	return differences;
}

/** Some rounds' values, then the range they span, so a figure the run cannot resolve says so. */
function spreadLine(label: string, values: number[]): string {
	if (values.length === 0) return `${label}: none`;
	const low = Math.min(...values);
	const high = Math.max(...values);
	return `${label}: ${values.map((ms) => ms.toFixed(3)).join(', ')} from ${low.toFixed(3)} to ${high.toFixed(3)} ms`;
}

/**
 * Each pass's own difference in every round, for the passes that the device times on both sides.
 * The paint's shading lands in the pass that draws the panel, so that pass tells its cost apart
 * from a frame whose other passes move with the GPU's clock.
 */
function passDifferenceLines(off: Side, on: Side): string[] {
	const plain = new Set((off.passes ?? []).map((pass) => pass.name));
	const names = (on.passes ?? []).map((pass) => pass.name).filter((name) => plain.has(name));
	return names.map((name) =>
		spreadLine(name, roundDifferences(off.passRoundsMs?.[name], on.passRoundsMs?.[name])),
	);
}

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`car paint on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_PAINT_COST, 'set NULL3D_PAINT_COST to time the car paint');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(
				`car-paint-cost.html?gpu=${gpu}&preset=${preset}&rounds=${ROUNDS}&seconds=${SECONDS}&warm-up=${WARM_UP}&paint=${variant}`,
			);
			const result = await pageResult<CostResult & { buffer: [number, number] }>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`PAINTCOST ${result.tier} at ${preset}, ${result.buffer[0]} by ${result.buffer[1]} pixels, ${variant}, ${ROUNDS} rounds of ${SECONDS} s after ${WARM_UP} s of play, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
					`off passes: ${passesLine(result.off)}`,
					`on passes: ${passesLine(result.on)}`,
					roundsLine('off', result.off),
					roundsLine('on', result.on),
					spreadLine('difference', roundDifferences(result.off.gpuRoundsMs, result.on.gpuRoundsMs)),
					...passDifferenceLines(result.off, result.on).map((line) => `pass ${line}`),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
