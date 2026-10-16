// What the specs that time an effect's cost share: the result that a cost page publishes, the wait
// for a quiet computer before each measurement, and the lines that print each side's medians. Each
// spec times its effect off and on, in turns, on a computer with a GPU of its own, and prints the
// load beside its figures, as other work on the computer would spoil them.
import { loadavg } from 'node:os';

/** One side of a cost page's turns: the medians with the effect off, or with it on. */
export interface Side {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
}

/** What a cost page publishes. */
export interface CostResult {
	error?: string;
	tier: string;
	off: Side;
	on: Side;
	failures: string[];
}

/** The 1-minute load under which a test measures, how often it checks it, and how long it waits. */
const QUIET_LOAD = 8;
const LOAD_CHECK_MS = 15_000;
const LOAD_WAIT_MS = 600_000;

/**
 * A cost test's time limit: the longest wait for a quiet computer, and the measurement's own
 * time after it.
 */
export const costTimeout = (measureMs: number) => LOAD_WAIT_MS + measureMs;

/** The computer's 1-minute load, as a report prints it. */
export const loadNow = () => (loadavg()[0] as number).toFixed(1);

/**
 * Waits until the computer's 1-minute load is under `QUIET_LOAD`, and returns the load. A load that
 * stays high fails the test after a time limit, so a quiet window is never held by a wait.
 */
export async function waitForQuiet(): Promise<string> {
	const waitUntil = Date.now() + LOAD_WAIT_MS;
	while ((loadavg()[0] as number) >= QUIET_LOAD) {
		if (Date.now() > waitUntil)
			throw new Error(
				`the load stayed at ${QUIET_LOAD} or above for ${LOAD_WAIT_MS / 60_000} minutes`,
			);
		await new Promise((resolve) => setTimeout(resolve, LOAD_CHECK_MS));
	}
	return loadNow();
}

/** A side's medians in one line, with each thread's busy time when `threads` is set. */
export function sideLine(name: string, side: Side, digits: number, threads = false): string {
	const ms = (value: number | null) => (value === null ? 'none' : value.toFixed(digits));
	const busy = threads
		? `, ${Object.entries(side.threads)
				.map(([thread, time]) => `${thread} ${ms(time)}`)
				.join(', ')}`
		: '';
	return `${name}: GPU ${ms(side.gpuMs)} ms, interval ${ms(side.intervalMs)} ms, CPU ${ms(side.cpuMs)} ms${busy}`;
}
