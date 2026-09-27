import { describe, expect, it } from 'bun:test';
import { checkNumber, checkVector, DEV } from './checks';
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

describe('development checks', () => {
	const player = { describe: () => '"Player" (slot 12)' };

	it('throw E1203 for NaN and Infinity, naming the component and the object', () => {
		expect(() => checkVector('setPosition', player, 0, Number.NaN, 0)).toThrow(
			'E1203: setPosition() got NaN for y on "Player" (slot 12).',
		);
		expect(() => checkVector('setRotation', player, 0, 0, 0, Number.POSITIVE_INFINITY)).toThrow(
			'got Infinity for w',
		);
		expect(() => checkNumber('setFov', 'fov', Number.NaN, player)).toThrow('got NaN for fov');
	});

	it('accept finite numbers', () => {
		expect(() => checkVector('setPosition', player, 1, -2, 3.5)).not.toThrow();
		expect(() => checkNumber('setFov', 'fov', 60, player)).not.toThrow();
	});

	it('are on when no bundler has defined the development constant', () => {
		expect(DEV).toBe(true);
	});
});
