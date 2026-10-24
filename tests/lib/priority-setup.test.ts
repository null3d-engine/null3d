// Checks how the background priority guard of Playwright's runs (priority-setup.ts) tells a run that
// times frames: one on the real GPU, or one that a cost switch turns on. The switch test reads every
// spec, so it is one of the guards that the pre-push check runs before a landing.
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { COST_VARIABLE, timesFrames } from './priority-setup.ts';

describe('the background priority guard', () => {
	it('judges which Playwright runs time frames', () => {
		expect(timesFrames({})).toBe(true);
		expect(timesFrames({ CI: '1' })).toBe(false);
		// Any variable named as a cost switch turns timing on, also one that no spec reads yet.
		expect(timesFrames({ CI: '1', NULL3D_SCREEN_COST: '1' })).toBe(true);
		expect(timesFrames({ CI: '1', NULL3D_A_NEW_EFFECT_COST: '1' })).toBe(true);
		expect(timesFrames({ CI: '1', NULL3D_SCREEN_COST: '' })).toBe(false);
		expect(timesFrames({ CI: '1', NULL3D_PORT: '5173', NULL3D_SCREEN_PRESETS: 'high' })).toBe(
			false,
		);
	});

	it('names the switch of every spec that runs only when asked as a cost switch', () => {
		// A spec that waits for a variable times frames on the computer's own GPU, so the guard must
		// know its switch by name: three such specs landed with switches that a list did not hold.
		const folder = new URL('../image/', import.meta.url);
		const switches = readdirSync(folder)
			.filter((file) => file.endsWith('.spec.ts'))
			.flatMap((file) => [
				...readFileSync(new URL(file, folder), 'utf8').matchAll(
					/test\.skip\(\s*!process\.env\.(NULL3D_\w+)/g,
				),
			])
			.map(([, name]) => name ?? '');
		expect(switches.length).toBeGreaterThan(0);
		expect(switches.filter((name) => !COST_VARIABLE.test(name))).toEqual([]);
	});
});
