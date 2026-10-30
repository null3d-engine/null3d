// Records each Playwright test where the other workers can read it, so a failure can name the tests
// that ran beside it on the same machine. The record clears when the test ends, so a worker that
// crashed leaves at most one stale record, which the next run clears.
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { clearRunningTests, clearTestRunning, noteTestRunning } from './running-tests.ts';

export default class NeighbourReporter implements Reporter {
	onBegin(): void {
		// A record never fails a test run: the instrument is worth less than the tests it describes.
		try {
			clearRunningTests();
		} catch {}
	}

	onTestBegin(test: TestCase, result: TestResult): void {
		try {
			noteTestRunning(result.workerIndex, test.title);
		} catch {}
	}

	onTestEnd(_test: TestCase, result: TestResult): void {
		try {
			clearTestRunning(result.workerIndex);
		} catch {}
	}
}
