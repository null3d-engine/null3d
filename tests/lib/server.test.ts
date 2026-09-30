import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { devServerPort, trackServer } from './server.ts';

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

describe('trackServer', () => {
	it('stops the server, and removes its signal handlers once no server runs', async () => {
		const before = process.listenerCount('SIGTERM');
		const child = spawn('sleep', ['30']);
		const stop = trackServer(child);
		expect(process.listenerCount('SIGTERM')).toBe(before + 1);
		const exited = new Promise((resolve) => child.once('exit', resolve));
		stop();
		await exited;
		expect(child.killed).toBe(true);
		expect(process.listenerCount('SIGTERM')).toBe(before);
	});

	it('forgets a server that exits by itself', async () => {
		const before = process.listenerCount('SIGINT');
		const child = spawn('true');
		trackServer(child);
		await new Promise((resolve) => child.once('exit', resolve));
		expect(process.listenerCount('SIGINT')).toBe(before);
	});
});
