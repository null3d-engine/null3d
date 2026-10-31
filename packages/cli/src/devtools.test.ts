import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { DevTools, freePort } from './devtools.js';

let server: Server | undefined;
afterEach(() => {
	server?.close();
	server = undefined;
});

describe('DevTools.connect', () => {
	it('gives up at its deadline when the port takes a request and never answers', async () => {
		// Another process can take the free port between its choice and the browser's start, and a
		// process that holds the connection open without answering kept the wait going forever.
		server = createServer(() => {});
		await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
		const address = server.address();
		const port = typeof address === 'object' && address ? address.port : 0;
		const started = Date.now();
		await expect(DevTools.connect(port, 300)).rejects.toThrow(
			`no browser answered on debugging port ${port}`,
		);
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('gives up at its deadline when no process listens on the port', async () => {
		const port = await freePort();
		await expect(DevTools.connect(port, 300)).rejects.toThrow(
			`no browser answered on debugging port ${port}`,
		);
	});
});
