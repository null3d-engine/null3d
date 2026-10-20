import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	checkoutServer,
	devServerPort,
	onStopSignal,
	REPO_ROOT,
	refuseOtherCopy,
	trackServer,
} from './server.ts';

/**
 * Serves what the dev server's checkout plugin answers for the copy at `root`, or a plain 404 for
 * every address without one, as a server from before the plugin does. Returns the server's address
 * and the function that stops it.
 */
function fakeDevServer(root?: string): { url: string; stop: () => void } {
	type Answer = { setHeader(name: string, value: string): void; end(): void };
	let path = '';
	let handler: ((req: unknown, res: Answer) => void) | undefined;
	if (root !== undefined) {
		const plugin = checkoutServer(root) as { configureServer(server: unknown): void };
		plugin.configureServer({
			middlewares: {
				use(at: string, fn: typeof handler) {
					path = at;
					handler = fn;
				},
			},
		});
	}
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			if (!handler || new URL(request.url).pathname !== path)
				return new Response('', { status: 404 });
			const headers = new Headers();
			handler(request, { setHeader: (name, value) => headers.set(name, value), end() {} });
			return new Response('', { headers });
		},
	});
	return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

describe('refuseOtherCopy', () => {
	it('lets a run use a dev server that serves this copy of the repository', async () => {
		const server = fakeDevServer(REPO_ROOT);
		try {
			await refuseOtherCopy(server.url);
		} finally {
			server.stop();
		}
	});

	it("refuses a dev server that serves another copy, and names that copy's folder", async () => {
		const other = mkdtempSync(join(tmpdir(), 'null3d other copy '));
		const server = fakeDevServer(other);
		try {
			const refusal = await refuseOtherCopy(server.url).then(
				() => '',
				(error: Error) => error.message,
			);
			expect(refusal).toContain('serves another copy of the repository');
			expect(refusal).toContain('null3d other copy');
			expect(refusal).toContain('NULL3D_PORT');
		} finally {
			server.stop();
			rmSync(other, { recursive: true });
		}
	});

	it('refuses a server that cannot name its copy, and an address where none answers', async () => {
		const server = fakeDevServer();
		try {
			await expect(refuseOtherCopy(server.url)).rejects.toThrow('does not name the copy');
		} finally {
			server.stop();
		}
		await expect(refuseOtherCopy(server.url)).rejects.toThrow('does not name the copy');
	});
});

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

describe('onStopSignal', () => {
	it('listens for the stop signals while a cleanup waits, and not after it is forgotten', () => {
		const before = process.listenerCount('SIGINT');
		const forget = onStopSignal(async () => {});
		expect(process.listenerCount('SIGINT')).toBe(before + 1);
		const child = spawn('sleep', ['30']);
		const stop = trackServer(child);
		expect(process.listenerCount('SIGINT')).toBe(before + 1);
		stop();
		expect(process.listenerCount('SIGINT')).toBe(before + 1);
		forget();
		expect(process.listenerCount('SIGINT')).toBe(before);
	});

	it('ends the sessions before the process exits on Ctrl-C', async () => {
		const script = `
			import { onStopSignal } from ${JSON.stringify(`${import.meta.dirname}/server.ts`)};
			onStopSignal(async () => {
				await Bun.sleep(50);
				console.log('cleaned');
			});
			console.log('ready');
			setInterval(() => {}, 1000);
		`;
		const child = Bun.spawn(['bun', '-e', script], { stdout: 'pipe' });
		const reader = child.stdout.getReader();
		let text = '';
		while (!text.includes('ready')) text += new TextDecoder().decode((await reader.read()).value);
		child.kill('SIGINT');
		for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
			text += new TextDecoder().decode(chunk.value);
		expect(text).toContain('cleaned');
		expect(await child.exited).toBe(130);
	});
});
