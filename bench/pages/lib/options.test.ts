import { describe, expect, test } from 'bun:test';
import { readChoice, readRunOptions } from './options';

describe('readRunOptions', () => {
	const read = (query: string) => readRunOptions(new URLSearchParams(query));

	test('reads hold, the count and the seconds', () => {
		expect(read('')).toEqual({ hold: false, count: null, seconds: null });
		expect(read('?hold&n=1000&seconds=2.5')).toEqual({ hold: true, count: 1000, seconds: 2.5 });
	});

	test('refuses counts and times that make no sense, with a fix in the message', () => {
		for (const query of ['n=0', 'n=-5', 'n=1.5', 'n=abc', 'n=', 'seconds=0', 'seconds=x']) {
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
