// What the tests of the on-and-off cost pages share. Each page plays a scene with one feature off and
// on, in turns, and publishes the medians of each side. Each test waits for a quiet computer, as other
// work would spoil the figures, and prints the load beside them. Every wait and page has a time
// limit, so a run ends on its own even when the computer stays busy. NULL3D_COST_TRIAL skips the
// wait, for an untimed trial that only checks that the pages run.
import { loadavg } from 'node:os';

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
const LOAD_WAIT_MS = 10 * 60_000;
/** How long a cost page has to publish its result. */
export const COST_PAGE_MS = 200_000;
/** A test's own limit: the wait for a quiet computer, the page, and the browser's start. */
export const COST_TEST_MS = LOAD_WAIT_MS + COST_PAGE_MS + 60_000;

/** The computer's 1-minute load, to one decimal. */
export const load = (): string => (loadavg()[0] as number).toFixed(1);

/**
 * Waits until the computer's 1-minute load is under the quiet limit. Throws when it stays above for
 * the whole wait, so the test fails rather than measuring a busy computer or waiting forever.
 */
export async function waitForQuietLoad(): Promise<void> {
	if (process.env.NULL3D_COST_TRIAL) return;
	const end = Date.now() + LOAD_WAIT_MS;
	while ((loadavg()[0] as number) >= QUIET_LOAD) {
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
