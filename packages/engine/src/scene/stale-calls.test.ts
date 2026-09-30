// A call on a destroyed light, object or instance batch never reaches the one that took its place:
// not in a development build, whose checks throw E1101, and not in a release build, which leaves
// those checks out. The scenario runs in a Bun process of its own for each build, because the
// development constant is fixed when the engine's modules load.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { StaleCallsResult } from './stale-calls-scenario';

/** Runs the scenario with the development checks on or off, and returns what it found. */
function staleCallsIn(development: boolean): StaleCallsResult {
	const scenario = join(import.meta.dirname, 'stale-calls-scenario.ts');
	const code = `const { staleCalls } = await import(${JSON.stringify(scenario)});
console.log(JSON.stringify(staleCalls()));`;
	const run = Bun.spawnSync([
		process.execPath,
		'--define',
		`__NULL3D_DEV__=${development}`,
		'-e',
		code,
	]);
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
	return JSON.parse(run.stdout.toString()) as StaleCallsResult;
}

/** The new light, object and batch as they were made, which no stale call may change. */
const UNTOUCHED = {
	light: { live: true, intensity: 1, color: [1, 1, 1] },
	position: [1, 2, 3],
	batchRow: [0, 0, 0],
};

describe('calls on destroyed things', () => {
	test('throw E1101 in a development build, and change nothing', () => {
		const { errors, ...left } = staleCallsIn(true);
		expect(left).toEqual(UNTOUCHED);
		expect(Object.values(errors).every((code) => code === 'E1101')).toBe(true);
		expect(Object.keys(errors).sort()).toEqual([
			'batch.destroy',
			'batch.positions',
			'light.destroy',
			'light.setColor',
			'light.setIntensity',
			'object.destroy',
			'object.setPosition',
			'object.translate',
		]);
	});

	test('change nothing in a release build, where only the core refuses them', () => {
		const { errors, ...left } = staleCallsIn(false);
		expect(left).toEqual(UNTOUCHED);
		// A destroyed object's queued changes reach the core, which refuses them at the next frame.
		expect(errors).toEqual({ 'batch.destroy': 'E1101', 'batch.positions': 'E1101' });
	});
});
