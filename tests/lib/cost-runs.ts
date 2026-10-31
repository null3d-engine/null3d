// What the tests of the on-and-off cost pages share. Each page plays a scene with one feature off and
// on, in turns, and publishes the medians of each side. Each test waits for a quiet computer, as other
// work would spoil the figures, and prints the load beside them. Every wait and page has a time
// limit, so a run ends on its own even when the computer stays busy. NULL3D_COST_TRIAL skips the
// wait, for an untimed trial that only checks that the pages run.
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { HEAVY_SLOT_ENV } from '../../tools/lib/build-cache.ts';

/** The medians of one side of a cost page: the feature off, or on. */
export interface CostSide {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
}

/** What a cost page publishes when it finishes. */
export interface CostResult {
	error?: string;
	tier: string;
	off: CostSide;
	on: CostSide;
	failures: string[];
}

/** The 1-minute load under which a test measures, and how often it checks the load. */
const QUIET_LOAD = 8;
const LOAD_CHECK_MS = 15_000;
/** How long a test waits for a quiet computer before it fails. */
export const LOAD_WAIT_MS = 10 * 60_000;
/** How long a cost page has to publish its result. */
export const COST_PAGE_MS = 200_000;
/** A test's own limit: the wait for a quiet computer, the page, and the browser's start. */
export const COST_TEST_MS = LOAD_WAIT_MS + COST_PAGE_MS + 60_000;

/** The computer's 1-minute load, to one decimal. */
export const load = (): string => (loadavg()[0] as number).toFixed(1);

/**
 * Why the job queue has closed this run's timing window, or undefined while the window stays open or
 * no queue runs this process. The queue names the run's slot in `NULL3D_HEAVY_SLOT`. Once the
 * computer has stayed busy for ten minutes of the run, it writes the reason into the slot's
 * `window-closed` file, closes the window and lets other work start, so the run can no longer measure.
 */
function windowClosed(): string | undefined {
	const slot = process.env[HEAVY_SLOT_ENV];
	if (!slot) return undefined;
	try {
		return (
			readFileSync(join(slot, 'window-closed'), 'utf8').trim() ||
			'the job queue closed the timing window'
		);
	} catch {
		return undefined;
	}
}

/**
 * Waits until the computer's 1-minute load is under the quiet limit. Throws when it stays above for
 * the whole wait, so the test fails rather than measuring a busy computer or waiting forever. It also
 * throws at once when the job queue has closed the run's timing window: otherwise each test of a
 * spec waits its own ten minutes, and while builds outside the queue keep the load high, one run
 * can hold the window for most of an hour.
 */
export async function waitForQuietLoad(): Promise<void> {
	if (process.env.NULL3D_COST_TRIAL) return;
	const end = Date.now() + LOAD_WAIT_MS;
	for (;;) {
		// Once the window has closed, other work runs beside this one, so even a quiet minute measures
		// nothing clean.
		const closed = windowClosed();
		if (closed) throw new Error(`${closed} (load now ${load()})`);
		if ((loadavg()[0] as number) < QUIET_LOAD) return;
		if (Date.now() >= end)
			throw new Error(
				`the 1-minute load stayed at ${QUIET_LOAD} or above for ${LOAD_WAIT_MS / 60_000} minutes (now ${load()})`,
			);
		await new Promise((resolve) => setTimeout(resolve, LOAD_CHECK_MS));
	}
}

const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(2));

/** One printed line of a side's medians. */
export const costLine = (name: string, side: CostSide): string =>
	`${name}: GPU ${ms(side.gpuMs)} ms, interval ${ms(side.intervalMs)} ms, CPU ${ms(side.cpuMs)} ms, ${Object.entries(
		side.threads,
	)
		.map(([thread, busy]) => `${thread} ${ms(busy)}`)
		.join(', ')}`;
