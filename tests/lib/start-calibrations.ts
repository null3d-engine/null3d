// The start calibration that each page of a run reports: a fixed piece of arithmetic, timed on the
// page's main thread as its start began. The run keeps every reading in one file, so a failure can
// say where its page falls among the run's pages, and the end of the run shows the spread.
//
// The absolute reading survives contention that was already on the machine when the page started.
// That is the case on a small runner, where two workers begin together: both pages read slowly, so
// their ratio to their own start is 1, and only the absolute reading stands out.
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Where the run keeps its readings, beside the records of the tests that run. */
const DEFAULT_DIR = join(import.meta.dirname, '../../target/running-tests');

/** The folder of the readings, which a test run may move to keep its own apart. */
const directory = () => process.env.NULL3D_RUNNING_TESTS_DIR ?? DEFAULT_DIR;

const file = () => join(directory(), 'calibrations.jsonl');

/** One page's reading, named by its address as a person reads it. */
export interface Calibration {
	page: string;
	ms: number;
}

/** Records one page's start calibration. A page that measured none records nothing. */
export function noteCalibration(page: string, ms: unknown): void {
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return;
	mkdirSync(directory(), { recursive: true });
	appendFileSync(file(), `${JSON.stringify({ page, ms })}\n`);
}

/**
 * Every reading that this run recorded, in the order the pages loaded. A page that a wait read
 * again records the same reading once.
 */
export function calibrations(): Calibration[] {
	let text: string;
	try {
		text = readFileSync(file(), 'utf8');
	} catch {
		return [];
	}
	const readings: Calibration[] = [];
	const seen = new Set<string>();
	for (const line of text.split('\n')) {
		if (line === '') continue;
		try {
			const { page, ms } = JSON.parse(line) as { page?: unknown; ms?: unknown };
			if (typeof page !== 'string' || typeof ms !== 'number') continue;
			if (!Number.isFinite(ms) || ms <= 0) continue;
			const key = `${page}\u0000${ms}`;
			if (seen.has(key)) continue;
			seen.add(key);
			readings.push({ page, ms });
		} catch {
			// A line that a worker is still writing reads as no reading.
		}
	}
	return readings;
}

/** What the run's readings look like together. */
export interface Spread {
	count: number;
	lowest: number;
	median: number;
	highest: number;
	/** The page with the highest reading. */
	highestPage: string;
}

/** The spread of `readings`, or undefined without one. */
export function spreadOf(readings: readonly Calibration[]): Spread | undefined {
	if (readings.length === 0) return undefined;
	const sorted = [...readings].sort((a, b) => a.ms - b.ms);
	const highest = sorted[sorted.length - 1] as Calibration;
	const middle = sorted[Math.floor(sorted.length / 2)] as Calibration;
	return {
		count: sorted.length,
		lowest: (sorted[0] as Calibration).ms,
		median: middle.ms,
		highest: highest.ms,
		highestPage: highest.page,
	};
}

/** How a number reads as a place: 1st, 2nd, 3rd, 4th. */
function ordinal(n: number): string {
	const rest = n % 100;
	if (rest >= 11 && rest <= 13) return `${n}th`;
	switch (n % 10) {
		case 1:
			return `${n}st`;
		case 2:
			return `${n}nd`;
		case 3:
			return `${n}rd`;
		default:
			return `${n}th`;
	}
}

/**
 * What a failure says about where its page's reading falls among the run's pages, or nothing
 * without a reading. A page that stands out from the run names itself, so one page that stalled
 * reads differently from a machine that slowed every page.
 */
export function calibrationNote(ms: unknown, readings = calibrations()): string {
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
	const spread = spreadOf(readings);
	if (!spread) return '';
	const reading = ms.toFixed(2);
	// The run's readings are the ones recorded when the note is composed, not the run's whole set.
	const recorded = readings.some((entry) => entry.ms === ms);
	const count = readings.length + (recorded ? 0 : 1);
	if (count === 1)
		return `; its start calibration ${reading} ms, the only page this run measured so far`;
	const place = readings.filter((entry) => entry.ms > ms).length + 1;
	const where = place === 1 ? 'the highest' : `the ${ordinal(place)} highest`;
	return `; its start calibration ${reading} ms was ${where} of ${count} pages so far this run (median ${spread.median.toFixed(2)} ms)`;
}

/** Clears the run's readings, which a run does as it starts. */
export function clearCalibrations(): void {
	rmSync(file(), { force: true });
}
