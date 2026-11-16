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
import { clearCalibrations } from './start-calibrations.ts';

// The records go to a folder of their own, so this test never reads or clears those of a test run
// that the machine runs beside it.
const saved = process.env.NULL3D_RUNNING_TESTS_DIR;
const dir = mkdtempSync(join(tmpdir(), 'null3d-running-'));

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
	if (saved === undefined) delete process.env.NULL3D_RUNNING_TESTS_DIR;
	else process.env.NULL3D_RUNNING_TESTS_DIR = saved;
});

beforeEach(() => {
	process.env.NULL3D_RUNNING_TESTS_DIR = dir;
	clearRunningTests();
	clearCalibrations();
});

describe('the record of running tests', () => {
	it('names a neighbour that started after this test began', () => {
		noteTestRunning(1, 'this one', 10_000);
		noteTestRunning(2, 's6 on high', 12_000);
		expect(neighbourNote(1, 20_000)).toBe(
			'; another worker was running "s6 on high" (started 2.0 s after this test)',
		);
	});

	it('names a neighbour that started before this test began', () => {
		noteTestRunning(1, 'this one', 10_000);
		noteTestRunning(2, 's6 on high', 8_000);
		expect(neighbourNote(1, 20_000)).toBe(
			'; another worker was running "s6 on high" (started 2.0 s before this test)',
		);
	});

	it('says when a neighbour started with this test', () => {
		noteTestRunning(1, 'this one', 10_000);
		noteTestRunning(2, 's6 on high', 10_200);
		expect(neighbourNote(1, 20_000)).toContain('(started with this test)');
	});

	it('says that no other worker ran when the worker ran alone', () => {
		noteTestRunning(1, 's4 on high', 10_000);
		expect(neighbourNote(1, 20_000)).toBe('; no other worker was running');
	});

	it('names the tests of several other workers', () => {
		noteTestRunning(1, 'this one', 10_000);
		noteTestRunning(2, 'long', 8_000);
		noteTestRunning(3, 'short', 9_000);
		const note = neighbourNote(1, 20_000);
		expect(note).toStartWith('; other workers were running');
		expect(note).toContain('"long"');
		expect(note).toContain('"short"');
	});

	it('forgets a test when its worker clears it', () => {
		noteTestRunning(1, 'this one', 10_000);
		noteTestRunning(2, 'done', 10_000);
		clearTestRunning(2);
		expect(neighbourNote(1, 20_000)).toBe('; no other worker was running');
	});

	it('reads back the record a worker keeps', () => {
		noteTestRunning(2, 'a test', 10_000);
		expect(runningTest(2)?.name).toBe('a test');
		clearTestRunning(2);
		expect(runningTest(2)).toBeUndefined();
	});

	it('says nothing outside a Playwright worker', () => {
		noteTestRunning(2, 'done', 10_000);
		expect(neighbourNote(undefined)).toBe('');
	});
});

describe('the reporter', () => {
	it('clears a crashed worker’s record, whose end gives no worker index', () => {
		const reporter = new NeighbourReporter();
		const test = { id: 'a-test', title: 's4 on high' } as TestCase;
		reporter.onBegin();
		reporter.onTestBegin(test, { workerIndex: 3 } as TestResult);
		expect(neighbourNote(4, Date.now())).toContain('"s4 on high"');
		reporter.onTestEnd(test, { workerIndex: -1 } as TestResult);
		expect(neighbourNote(4, Date.now())).toBe('; no other worker was running');
	});
});
