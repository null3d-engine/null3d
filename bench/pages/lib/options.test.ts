import { describe, expect, test } from 'bun:test';
import { HOLD_TIME } from '../../scenes/spec';
import { readChoice, readRunOptions } from './options';

describe('readRunOptions', () => {
	const read = (query: string) => readRunOptions(new URLSearchParams(query));

	test('reads hold, demo, the count, the seconds, the soak, the shadow cascades and the far cascade interval', () => {
		expect(read('')).toEqual({
			hold: null,
			demo: false,
			count: null,
			seconds: null,
			soak: null,
			shadows: null,
			far: null,
		});
		expect(read('?hold&n=1000&seconds=2.5&shadows=3&far=1')).toEqual({
			hold: HOLD_TIME,
			demo: false,
			count: 1000,
			seconds: 2.5,
			soak: null,
			shadows: 3,
			far: 1,
		});
		expect(read('?soak=30').soak).toBe(30);
		expect(read('?hold=3.25').hold).toBe(3.25);
		expect(read('?hold=0').hold).toBe(0);
		expect(read('?demo').demo).toBe(true);
	});

	test('refuses counts and times that make no sense, with a fix in the message', () => {
		for (const query of [
			'n=0',
			'n=-5',
			'n=1.5',
			'n=abc',
			'n=',
			'seconds=0',
			'seconds=x',
			'soak=0',
			'soak=2.5',
			'hold=-1',
			'hold=soon',
			'shadows=0',
			'shadows=5',
			'far=0',
			'far=9',
			'far=1.5',
			'shadows=2.5',
		]) {
			expect(() => read(query)).toThrow(/is not valid: use/);
		}
	});
});

describe('readChoice', () => {
	const renderers = ['webgl', 'webgpu'] as const;

	test('returns the chosen word', () => {
		expect(readChoice(new URLSearchParams('renderer=webgpu'), 'renderer', renderers)).toBe(
			'webgpu',
		);
	});

	test('names the valid choices when the switch is missing or wrong', () => {
		expect(() => readChoice(new URLSearchParams(''), 'renderer', renderers)).toThrow(
			'Add ?renderer=webgl or ?renderer=webgpu to the page address.',
		);
		expect(() => readChoice(new URLSearchParams('renderer=gl'), 'renderer', renderers)).toThrow(
			'"gl" is not a valid renderer. Use ?renderer=webgl or ?renderer=webgpu.',
		);
	});
});
