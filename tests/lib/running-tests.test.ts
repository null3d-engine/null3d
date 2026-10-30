import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import NeighbourReporter from './neighbour-reporter.ts';
import {
	clearRunningTests,
	clearTestRunning,
	neighbourNote,
	noteTestRunning,
	runningTest,
} from './running-tests.ts';

// The records go to a folder of their own, so this test never reads or clears those of a test run
// that the machine runs beside it.
const saved = process.env.NULL3D_RUNNING_TESTS_DIR;
process.env.NULL3D_RUNNING_TESTS_DIR = mkdtempSync(join(tmpdir(), 'null3d-running-'));

afterAll(() => {
	rmSync(process.env.NULL3D_RUNNING_TESTS_DIR as string, { recursive: true, force: true });
	if (saved === undefined) delete process.env.NULL3D_RUNNING_TESTS_DIR;
	else process.env.NULL3D_RUNNING_TESTS_DIR = saved;
});

beforeEach(() => clearRunningTests());

describe('the record of running tests', () => {
	it('names the test that another worker was running, and not this one', () => {
		noteTestRunning(1, 's4 on high');
		noteTestRunning(2, 's6 on high');
		expect(neighbourNote(1, Date.now() + 2000)).toMatch(
			/^; another worker was running "s6 on high" \(started 2\.\d s ago\)$/,
		);
	});

	it('says that no other worker ran when the worker ran alone', () => {
		noteTestRunning(1, 's4 on high');
		expect(neighbourNote(1)).toBe('; no other worker was running');
	});

	it('names the tests of several other workers', () => {
		noteTestRunning(1, 'this one');
		noteTestRunning(2, 'long');
		noteTestRunning(3, 'short');
		const note = neighbourNote(1, Date.now() + 3000);
		expect(note).toStartWith('; other workers were running');
		expect(note).toContain('"long"');
		expect(note).toContain('"short"');
	});

	it('forgets a test when its worker clears it', () => {
		noteTestRunning(1, 'this one');
		noteTestRunning(2, 'done');
		clearTestRunning(2);
		expect(neighbourNote(1)).toBe('; no other worker was running');
	});

	it('reads back the record a worker keeps', () => {
		noteTestRunning(2, 'a test');
		expect(runningTest(2)?.name).toBe('a test');
		clearTestRunning(2);
		expect(runningTest(2)).toBeUndefined();
	});

	it('says nothing outside a Playwright worker', () => {
		noteTestRunning(2, 'done');
		expect(neighbourNote(undefined)).toBe('');
	});
});

describe('the reporter', () => {
	it('records the test a worker starts and clears it when the test ends', () => {
		const reporter = new NeighbourReporter();
		reporter.onBegin();
		reporter.onTestBegin({ title: 's4 on high' } as TestCase, { workerIndex: 3 } as TestResult);
		expect(neighbourNote(4)).toContain('"s4 on high"');
		reporter.onTestEnd({} as TestCase, { workerIndex: 3 } as TestResult);
		expect(neighbourNote(4)).toBe('; no other worker was running');
	});
});
