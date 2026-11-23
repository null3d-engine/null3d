import { describe, expect, test } from 'bun:test';
import { soundBounds } from './bounds';

describe('soundBounds', () => {
	test('skips the codec padding at both ends of a file', () => {
		const channel = new Float32Array(10_000);
		for (let i = 1105; i < 10_000 - 600; i++) channel[i] = Math.sin(i * 0.1) * 0.5 + 0.6;
		const { start, end } = soundBounds([channel], 1000);
		expect(start).toBe(1.105);
		expect(end).toBe(9.4);
	});

	test('takes sound in any channel', () => {
		const left = new Float32Array(100);
		const right = new Float32Array(100);
		right[3] = 0.5;
		right[90] = 0.5;
		expect(soundBounds([left, right], 100)).toEqual({ start: 0.03, end: 0.91 });
	});

	test('cuts no more than the most padding a codec adds', () => {
		const silent = new Float32Array(10_000);
		const { start } = soundBounds([silent], 1000);
		expect(start).toBe(2.048);
	});
});
