import { describe, expect, test } from 'bun:test';
import { parseGpuPassesArgs } from '../gpu-passes';
import { type PassRun, passChanges, passTable } from './gpu-passes';

/** A run of one build with each pass's GPU time per frame, in the frame's order. */
function run(build: 'baseline' | 'new', round: number, passes: Record<string, number>): PassRun {
	return { build, round, passes: Object.entries(passes).map(([name, ms]) => ({ name, ms })) };
}

/** Three runs of each build, with the passes that both builds time. */
const runs: PassRun[] = [
	run('baseline', 1, { opaque: 2.0, 'shadow cascade 1': 1.0 }),
	run('baseline', 2, { opaque: 2.2, 'shadow cascade 1': 1.2 }),
	run('baseline', 3, { opaque: 2.4, 'shadow cascade 1': 1.1 }),
	run('new', 1, { opaque: 3.0, 'shadow cascade 1': 1.1 }),
	run('new', 2, { opaque: 3.2, 'shadow cascade 1': 1.1 }),
	run('new', 3, { opaque: 3.4, 'shadow cascade 1': 1.2 }),
];

describe('the per-pass split', () => {
	test("takes each build's median of the runs that timed a pass, and the difference between them", () => {
		expect(passChanges(runs)).toEqual([
			{
				name: 'opaque',
				baselineMs: 2.2,
				newMs: 3.2,
				deltaMs: 1,
				change: 1 / 2.2,
			},
			{
				name: 'shadow cascade 1',
				baselineMs: 1.1,
				newMs: 1.1,
				deltaMs: 0,
				change: 0,
			},
		]);
	});

	test('prints one line per pass, the two figures, the difference and the change, largest first', () => {
		expect(passTable(passChanges(runs))).toEqual([
			'Pass              Baseline ms  New ms  Difference  Change',
			'opaque                   2.20    3.20       +1.00  +45.5%',
			'shadow cascade 1         1.10    1.10        0.00    0.0%',
			'',
			'Largest increase: opaque, +1.00 ms (+45.5%), from 2.20 to 3.20 ms.',
		]);
	});

	test('keeps a pass that only one build timed, without a difference, and names it below the ranking', () => {
		const sided = [...runs, run('baseline', 4, { bloom: 0.5 }), run('new', 4, { ssr: 0.7 })];
		const rows = passChanges(sided);
		expect(rows.find((row) => row.name === 'bloom')).toEqual({
			name: 'bloom',
			baselineMs: 0.5,
			newMs: null,
			deltaMs: null,
			change: null,
		});
		const table = passTable(rows);
		expect(table).toContain('bloom                    0.50       -           -     n/a');
		expect(table).toContain('ssr                         -    0.70           -     n/a');
		expect(table.at(-1)).toBe(
			'Timed in one build only: bloom (baseline 0.50 ms); ssr (new 0.70 ms).',
		);
	});

	test('says so when no pass has time from both builds', () => {
		expect(passTable(passChanges([]))).toEqual(['No pass has GPU time in either build.']);
		expect(passTable(passChanges([run('baseline', 1, { opaque: 1 })]))).toContain(
			'No pass has GPU time in both builds.',
		);
	});
});

describe("the per-pass split's options", () => {
	test("take both steps by default, with the comparison's least rounds and a short run", () => {
		expect(parseGpuPassesArgs([])).toEqual({
			steps: 'both',
			base: null,
			build: true,
			runs: 3,
			seconds: 4,
		});
	});

	test('take the one step that is named, a base and the build option', () => {
		const options = parseGpuPassesArgs([
			'--prepare',
			'--base',
			'../main',
			'--no-build',
			'--runs',
			'5',
			'--seconds',
			'10',
		]);
		expect(options).toEqual({
			steps: 'prepare',
			base: '../main',
			build: false,
			runs: 5,
			seconds: 10,
		});
		expect(parseGpuPassesArgs(['--measure']).steps).toBe('measure');
	});

	test('refuse an empty base, too few rounds and no measured time', () => {
		expect(() => parseGpuPassesArgs(['--base', ''])).toThrow('--base');
		expect(() => parseGpuPassesArgs(['--runs', '2'])).toThrow('--runs');
		expect(() => parseGpuPassesArgs(['--seconds', '0'])).toThrow('--seconds');
	});
});
