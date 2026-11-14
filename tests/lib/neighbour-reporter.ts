// Records each Playwright test where the other workers can read it, so a failure can name the tests
// that ran beside it on the same machine. The record clears when the test ends, and when its worker
// crashes: a crashed worker's test ends with worker index -1, so the index comes from the test's own
// begin. It also shows the spread of the pages' start readings at the end of the run.
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { clearRunningTests, clearTestRunning, noteTestRunning } from './running-tests.ts';
import { calibrations, clearCalibrations, spreadOf } from './start-calibrations.ts';

export default class NeighbourReporter implements Reporter {
	/** The worker that began each test, for the end that a worker crash reports without one. */
	private readonly workers = new Map<string, number>();

	printsToStdio(): boolean {
		return true;
	}

	onBegin(): void {
		this.workers.clear();
		// A record never fails a test run: the instrument is worth less than the tests it describes.
		try {
			clearRunningTests();
		} catch {}
		try {
			clearCalibrations();
		} catch {}
	}

	onTestBegin(test: TestCase, result: TestResult): void {
		if (result.workerIndex >= 0) this.workers.set(test.id, result.workerIndex);
		try {
			noteTestRunning(result.workerIndex, test.title);
		} catch {}
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		// A crashed worker's test ends with no worker index, so its begin gives the record to clear.
		const worker = result.workerIndex >= 0 ? result.workerIndex : this.workers.get(test.id);
		this.workers.delete(test.id);
		try {
			clearTestRunning(worker);
		} catch {}
	}

	onEnd(): void {
		const spread = spreadOf(calibrations());
		if (spread === undefined) return;
		const pages = spread.count === 1 ? 'page' : 'pages';
		process.stdout.write(
			`start calibrations: ${spread.count} ${pages}, lowest ${spread.lowest.toFixed(2)} ms, median ${spread.median.toFixed(2)} ms, highest ${spread.highest.toFixed(2)} ms (${spread.highestPage})\n`,
		);
	}
}
