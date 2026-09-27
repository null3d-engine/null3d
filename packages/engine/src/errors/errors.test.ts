import { describe, expect, it } from 'bun:test';
import { checkFinite, DEV } from './checks';
import { ERRORS } from './codes';
import { EngineError } from './engine-error';

describe('EngineError', () => {
	it('carries its code, the fix and a link to the code page', () => {
		const error = new EngineError('E1203', 'setPosition() got NaN for x on "Player" (slot 12).');
		expect(error.code).toBe('E1203');
		expect(
			error.message.startsWith(
				'E1203: setPosition() got NaN for x on "Player" (slot 12). Check the value',
			),
		).toBe(true);
		expect(error.message).toContain('/docs/errors/E1203.md');
		expect(error.docs.endsWith('/docs/errors/E1203.md')).toBe(true);
		expect(error).toBeInstanceOf(Error);
	});

	it('uses codes whose examples start with the code', () => {
		for (const [code, entry] of Object.entries(ERRORS))
			expect(entry.example.startsWith(`${code}: `)).toBe(true);
	});
});

describe('checkFinite', () => {
	it('throws E1203 for NaN and Infinity, naming the argument and the object', () => {
		expect(() =>
			checkFinite('setPosition', ['x', 'y', 'z'], [0, Number.NaN, 0], '"Player" (slot 12)'),
		).toThrow('E1203: setPosition() got NaN for y on "Player" (slot 12).');
		expect(() => checkFinite('setScale', ['x'], [Number.POSITIVE_INFINITY], 'a mesh')).toThrow(
			'got Infinity for x',
		);
	});

	it('accepts finite numbers', () => {
		expect(() => checkFinite('setPosition', ['x', 'y', 'z'], [1, -2, 3.5], 'a mesh')).not.toThrow();
	});

	it('is on when no bundler has defined the development constant', () => {
		expect(DEV).toBe(true);
	});
});
