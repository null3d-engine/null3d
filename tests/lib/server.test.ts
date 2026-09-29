import { describe, expect, it } from 'bun:test';
import { devServerPort } from './server.ts';

describe('devServerPort', () => {
	it('takes the port NULL3D_PORT names, or 5173 without it', () => {
		expect(devServerPort(undefined)).toBe(5173);
		expect(devServerPort('')).toBe(5173);
		expect(devServerPort('6173')).toBe(6173);
	});

	it('refuses a value that is not a port it can use with the two ports above it', () => {
		expect(() => devServerPort('80')).toThrow('NULL3D_PORT must be a port from 1024 to 65533');
		expect(() => devServerPort('65534')).toThrow('not 65534');
		expect(() => devServerPort('51.73')).toThrow('not 51.73');
	});
});
