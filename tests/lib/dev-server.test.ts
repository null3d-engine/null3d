import { describe, expect, it } from 'bun:test';
import { devServerAddress } from './dev-server.ts';

describe('devServerAddress', () => {
	it('reads an address whose port the server printed in bold', () => {
		const line =
			'  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m42087\x1b[22m/\x1b[39m';
		expect(devServerAddress(line)).toBe('http://localhost:42087/');
	});

	it('reads an address with no colour', () => {
		expect(devServerAddress('  ➜  Local:   http://localhost:5173/')).toBe('http://localhost:5173/');
	});

	it('finds no address before the server prints one', () => {
		expect(devServerAddress('VITE v8.3.1  ready in 127 ms\n')).toBeUndefined();
	});
});
