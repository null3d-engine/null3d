// What the plant material's wind offset costs at each preset, on the Mac's real GPU. The plant
// review page draws one hawthorn in its batch view: the turntable sheet draws the plant once in
// each of 30 cells, so the material's vertex work scales with the cell count while the scene keeps
// one plant. The on side uses the preset's sway distance, and the off side uses one millimeter, so
// the plant stands past the fade. The field runs on both sides, so its cost is common and cancels;
// the difference is the material's own cost: its vertex offset and the far shadow redraws that its
// moving vertices force. The spec also splits the difference into the shadow cascades' share and
// the rest.
//
// One side per page load, because a material's sway distance is fixed when the engine makes it. Each
// pair is two loads of the same page with the same view, size, wind and measurement time, in the
// opposite order on alternate presets so a drift through the run does not favour a side. It runs only
// with NULL3D_PLANT_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_PLANT_COST=1 bun run test:browser -- plant-wind-cost.spec.ts --workers=1.
// NULL3D_PLANT_PRESETS narrows the presets, as a list. Each side logs the machine's load and the
// processes running beside it, so a quiet-window claim rests on what ran, not on the load alone.
import { execFileSync } from 'node:child_process';
import { expect, type Page, test } from '@playwright/test';
import {
	COST_PAGE_MS,
	COST_TEST_MS,
	load,
	type SideCost,
	waitForQuietLoad,
} from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

test.skip(!process.env.NULL3D_PLANT_COST, 'set NULL3D_PLANT_COST to time the plant material');

type Preset = 'low' | 'medium' | 'high' | 'ultra';

/** The presets to time, and the rounds and seconds of each side. */
const PRESETS = (process.env.NULL3D_PLANT_PRESETS ?? 'low,medium,high,ultra').split(
	',',
) as Preset[];
const ROUNDS = Math.max(1, Number(process.env.NULL3D_PLANT_ROUNDS ?? 5));
const SECONDS = Math.max(1, Number(process.env.NULL3D_PLANT_SECONDS ?? 2));
/** The turntable sheet's cells, each drawing the plant once. */
const TURNS = 30;

/**
 * The timing window's own guard, run before each preset so the run's record carries the guard's
 * answer rather than an assumption. It asks the coordination helpers whether a marker stands and
 * whether its holder is alive.
 */
const GUARD_COMMAND =
	'source /Users/ram/dev/null3d/.internal/coordination/quiet-window.sh; ' +
	'quiet_markers_present /Users/ram/dev/null3d/.internal/coordination && ' +
	'quiet_holder_alive /Users/ram/dev/null3d/.internal/coordination && ' +
	'echo "window open" || echo "window NOT open"';

/** What one side publishes. */
interface Result {
	error?: string;
	tier: string;
	preset: string;
	side: 'on' | 'off';
	sway: number | null;
	wind: number;
	cost: SideCost;
	built: {
		species?: string;
		view?: string;
		size?: number[];
		grid?: [number, number];
		cells?: unknown[];
		plant?: { triangles?: number[] };
	} | null;
	failures: string[];
}

/** The processes above 5% CPU, so a quiet-window claim names what ran beside the timing. */
function running(): string {
	try {
		const lines = execFileSync('ps', ['-A', '-o', 'pid=,%cpu=,command='], {
			encoding: 'utf8',
		}).split('\n');
		const rows = lines
			.map((line) => {
				const match = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
				return match
					? { pid: match[1] as string, cpu: Number(match[2]), command: match[3] as string }
					: null;
			})
			.filter((row): row is { pid: string; cpu: number; command: string } => row !== null)
			.filter((row) => row.cpu >= 5)
			.sort((a, b) => b.cpu - a.cpu)
			.slice(0, 6)
			.map((row) => `${row.pid} ${row.cpu.toFixed(0)}% ${row.command.slice(0, 70)}`);
		return rows.length > 0 ? rows.join(' | ') : 'nothing above 5%';
	} catch {
		return 'ps failed';
	}
}

/** The middle of the round medians, and the range they span. */
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}
const spread = (values: number[]): number =>
	values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);

/** The shadow cascades' time in one side, from its named passes. */
function shadowMs(side: SideCost): number {
	return side.passes
		.filter((pass) => /^shadow cascade/.test(pass.name))
		.reduce((sum, pass) => sum + (pass.ms ?? 0), 0);
}

/** Opens the page at one preset and side, and reads its measurement. */
async function measured(page: Page, preset: Preset, side: 'on' | 'off'): Promise<Result> {
	const query = new URLSearchParams({
		gpu: 'webgpu',
		preset,
		side,
		rounds: String(ROUNDS),
		seconds: String(SECONDS),
	});
	await page.goto(`plant-wind-cost.html?${query}`);
	const result = await pageResult<Result>(page, COST_PAGE_MS);
	expect(result.error).toBeUndefined();
	expect(result.failures, `${preset} ${side}: page failures`).toEqual([]);
	expect(result.side, `${preset}: the side the page measured`).toBe(side);
	expect(result.wind, `${preset}: the field's strength`).toBe(2);
	expect(result.sway, `${preset} ${side}: the material's distance`).toBe(
		side === 'off' ? 0.001 : null,
	);
	expect(result.preset, `${preset}: the preset the engine drew`).toBe(preset);
	expect(result.built?.species).toBe('hawthorn-shrub');
	expect(result.built?.view, 'the review page drew its batch view').toBe('turntable');
	expect(result.built?.cells?.length, 'the sheet drew every cell').toBe(TURNS);
	expect(result.built?.size, 'the review page drew the fixed size').toEqual([960, 540]);
	expect(result.cost.gpuMs, `${preset} ${side}: the GPU timer read a frame`).not.toBeNull();
	return result;
}

test('the plant material costs its wind offset at each preset in the batch view', async ({
	page,
}) => {
	test.setTimeout(COST_TEST_MS + PRESETS.length * 2 * COST_PAGE_MS);
	await waitForQuietLoad();
	await page.setViewportSize({ width: 1600, height: 900 });
	const unresolved: string[] = [];
	for (const [index, preset] of PRESETS.entries()) {
		const guard = execFileSync('zsh', ['-c', GUARD_COMMAND], { encoding: 'utf8' }).trim();
		console.log(`GUARD ${preset}: ${guard}`);
		if (!guard.includes('window open'))
			throw new Error(`the quiet-window guard says "${guard}" before ${preset}; stopping`);
		const order = index % 2 === 0 ? (['on', 'off'] as const) : (['off', 'on'] as const);
		const sides: Partial<Record<'on' | 'off', Result>> = {};
		const conditions: string[] = [];
		for (const side of order) {
			conditions.push(`${side} before: load ${load()}; ${running()}`);
			sides[side] = await measured(page, preset, side);
			conditions.push(`${side} after: load ${load()}; ${running()}`);
		}
		const on = sides.on as Result;
		const off = sides.off as Result;
		const onRounds = on.cost.gpuRoundsMs;
		const offRounds = off.cost.gpuRoundsMs;
		const onMs = median(onRounds);
		const offMs = median(offRounds);
		const difference = onMs - offMs;
		const shadow = shadowMs(on.cost) - shadowMs(off.cost);
		const offset = difference - shadow;
		console.log(
			[
				`PLANTCOST ${preset} ${on.tier} at ${on.preset}`,
				`  on  ${onMs.toFixed(3)} ms, rounds ${onRounds.map((ms) => ms.toFixed(3)).join(', ')}, spread ${spread(onRounds).toFixed(3)}`,
				`  off ${offMs.toFixed(3)} ms, rounds ${offRounds.map((ms) => ms.toFixed(3)).join(', ')}, spread ${spread(offRounds).toFixed(3)}`,
				`  difference ${difference.toFixed(3)} ms = shadow cascades ${shadow.toFixed(3)} ms + the offset's rest ${offset.toFixed(3)} ms`,
				`  conditions: ${conditions.join(' || ')}`,
			].join('\n'),
		);
		const floor = Math.max(spread(onRounds), spread(offRounds));
		if (Math.abs(difference) <= floor)
			unresolved.push(
				`${preset}: difference ${difference.toFixed(3)} ms is at or below the run's spread ${floor.toFixed(3)} ms`,
			);
	}
	if (unresolved.length > 0) console.log(`UNRESOLVED\n  ${unresolved.join('\n  ')}`);
	else console.log('RESOLVED every preset');
});
