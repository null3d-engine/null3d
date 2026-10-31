import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearRunningTests } from './running-tests.ts';
import { stallMessage } from './stall-message.ts';
import { clearCalibrations, noteCalibration } from './start-calibrations.ts';

// The readings and records go to a folder of their own, so this test never reads or clears those
// of a test run that the machine runs beside it.
const savedDir = process.env.NULL3D_RUNNING_TESTS_DIR;
const savedWorker = process.env.TEST_WORKER_INDEX;
const dir = mkdtempSync(join(tmpdir(), 'null3d-stall-'));

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
	if (savedDir === undefined) delete process.env.NULL3D_RUNNING_TESTS_DIR;
	else process.env.NULL3D_RUNNING_TESTS_DIR = savedDir;
	if (savedWorker === undefined) delete process.env.TEST_WORKER_INDEX;
	else process.env.TEST_WORKER_INDEX = savedWorker;
});

beforeEach(() => {
	process.env.NULL3D_RUNNING_TESTS_DIR = dir;
	process.env.TEST_WORKER_INDEX = '0';
	clearRunningTests();
	clearCalibrations();
});

describe('the message of a page that stopped noting steps', () => {
	it('quotes the last five steps, the page’s place and the quiet machine', () => {
		noteCalibration('another page', 0.5);
		noteCalibration('this page', 3);
		const trail = ['1 ms a', '2 ms b', '3 ms c', '4 ms d', '5 ms e', '6 ms f'];
		expect(stallMessage(trail, 40_000, 3)).toBe(
			'no result and no new step within 40 s. The last steps:\n2 ms b\n3 ms c\n4 ms d\n5 ms e\n6 ms f\nits start calibration 3.00 ms was the highest of 2 pages so far this run (median 3.00 ms); no other worker was running',
		);
	});

	it('says the reading is missing and the machine was quiet', () => {
		expect(stallMessage(['1 ms a'], 2000, 0)).toBe(
			'no result and no new step within 2 s. The last steps:\n1 ms a\nits start reading could not be read; no other worker was running',
		);
	});

	it('says the reading is missing outside a Playwright worker', () => {
		delete process.env.TEST_WORKER_INDEX;
		expect(stallMessage(['1 ms a'], 2000, 0)).toBe(
			'no result and no new step within 2 s. The last steps:\n1 ms a\nits start reading could not be read',
		);
	});
});
