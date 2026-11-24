// The town's night: the houses' windows light at dusk and go out at eleven, then stay out through
// the hours after midnight until the next dusk, while the town's lamps are lit.
import { describe, expect, it } from 'bun:test';
import { NIGHT_HOURS } from '../../lib/stage';
import { windowsLit } from './town';

describe("the houses' windows", () => {
	it('light with the dark hours and go out at eleven at night', () => {
		expect(windowsLit(true, NIGHT_HOURS.start - 0.1)).toBe(false);
		expect(windowsLit(true, NIGHT_HOURS.start + 0.1)).toBe(true);
		expect(windowsLit(true, 22.99)).toBe(true);
		expect(windowsLit(true, 23)).toBe(false);
	});

	it('stay out after midnight, and until the next dusk', () => {
		expect(windowsLit(true, 0.5)).toBe(false);
		expect(windowsLit(true, 3)).toBe(false);
		expect(windowsLit(true, NIGHT_HOURS.end + 0.1)).toBe(false);
	});

	it('stay out while the town lamps are not lit', () => {
		expect(windowsLit(false, 20)).toBe(false);
	});
});
