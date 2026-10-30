import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	type Calibration,
	calibrationNote,
	calibrations,
	clearCalibrations,
	noteCalibration,
	spreadOf,
} from './start-calibrations.ts';

// The readings go to a folder of their own, so this test never reads or clears those of a test run
// that the machine runs beside it.
const saved = process.env.NULL3D_RUNNING_TESTS_DIR;
const dir = mkdtempSync(join(tmpdir(), 'null3d-calibrations-'));

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
	if (saved === undefined) delete process.env.NULL3D_RUNNING_TESTS_DIR;
	else process.env.NULL3D_RUNNING_TESTS_DIR = saved;
});

beforeEach(() => {
	process.env.NULL3D_RUNNING_TESTS_DIR = dir;
	clearCalibrations();
});

const readings: Calibration[] = [
	{ page: 'a on webgpu', ms: 1 },
	{ page: 'b on webgpu', ms: 2 },
	{ page: 'c on webgpu', ms: 3 },
];

describe('the run’s start readings', () => {
	it('keeps the reading that each page reports', () => {
		noteCalibration('a on webgpu', 0.5);
		noteCalibration('b on webgpu', 0.75);
		expect(calibrations()).toEqual([
			{ page: 'a on webgpu', ms: 0.5 },
			{ page: 'b on webgpu', ms: 0.75 },
		]);
	});

	it('ignores a page that measured nothing', () => {
		noteCalibration('a on webgpu', undefined);
		noteCalibration('a on webgpu', 0);
		noteCalibration('a on webgpu', Number.NaN);
		noteCalibration('a on webgpu', -1);
		expect(calibrations()).toEqual([]);
	});

	it('gives the spread of the run', () => {
		expect(spreadOf(readings)).toEqual({
			count: 3,
			lowest: 1,
			median: 2,
			highest: 3,
			highestPage: 'c on webgpu',
		});
	});

	it('has no spread without a reading', () => {
		expect(spreadOf([])).toBeUndefined();
	});

	it('says where the highest page falls', () => {
		expect(calibrationNote(3, readings)).toBe(
			'; its start calibration 3.00 ms was the highest of 3 pages this run (median 2.00 ms)',
		);
	});

	it('says where a lower page falls', () => {
		expect(calibrationNote(1, readings)).toBe(
			'; its start calibration 1.00 ms was the 3rd highest of 3 pages this run (median 2.00 ms)',
		);
	});

	it('counts a page whose reading the run did not record', () => {
		expect(calibrationNote(5, readings)).toBe(
			'; its start calibration 5.00 ms was the highest of 4 pages this run (median 2.00 ms)',
		);
	});

	it('names a run of one page', () => {
		expect(calibrationNote(2, [readings[1] as Calibration])).toBe(
			'; its start calibration 2.00 ms, the only page this run measured',
		);
	});

	it('says nothing without a reading or a run', () => {
		expect(calibrationNote(undefined, readings)).toBe('');
		expect(calibrationNote(3, [])).toBe('');
	});
});
