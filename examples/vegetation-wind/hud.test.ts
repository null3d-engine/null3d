// The wind demo's control messages: a slider's string becomes the wind's strength or the bearing,
// and the Hold button toggles still air.
import { describe, expect, test } from 'bun:test';
import { applyWindControl } from './hud';

/** The panel's state before any message arrives. */
const start = { power: 7, bearing: 35, still: false };

describe('the wind panel messages', () => {
	test('the strength slider sets the wind strength', () => {
		expect(applyWindControl(start, 'wind', '0').power).toBe(0);
		expect(applyWindControl(start, 'wind', '12').power).toBe(12);
		expect(applyWindControl(start, 'wind', '5.5').power).toBe(5.5);
	});

	test('the Hold button toggles still air, and the slider leaves it alone', () => {
		expect(applyWindControl(start, 'wind', 'still').still).toBe(true);
		expect(applyWindControl({ ...start, still: true }, 'wind', 'still').still).toBe(false);
		expect(applyWindControl({ ...start, still: true }, 'wind', '6').still).toBe(true);
	});

	test('the direction slider sets the bearing', () => {
		expect(applyWindControl(start, 'bearing', '0').bearing).toBe(0);
		expect(applyWindControl(start, 'bearing', '270').bearing).toBe(270);
	});

	test('a message for another group answers the same state', () => {
		expect(applyWindControl(start, 'season', 'winter')).toBe(start);
		expect(applyWindControl(start, 'wind', 'a label')).toBe(start);
	});
});
