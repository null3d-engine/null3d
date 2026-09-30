import { afterEach, expect, test } from 'bun:test';
import {
	createServer,
	type IncomingMessage,
	request,
	type Server,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect } from 'vite';
import { collectorRoutes } from './report-collector.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/** A server with the collector's routes, which strips each route's prefix as Vite's server does. */
async function collector(): Promise<{ server: Server; port: number }> {
	const routes: [string, Handler][] = [];
	collectorRoutes({
		use: (path: string, handle: Handler) => routes.push([path, handle]),
	} as unknown as Connect.Server);
	const server = createServer((req, res) => {
		const route = routes.find(([path]) => req.url?.startsWith(path));
		if (!route) {
			res.statusCode = 404;
			return res.end();
		}
		req.url = (req.url ?? '').slice(route[0].length) || '/';
		route[1](req, res, () => {});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, port: (server.address() as AddressInfo).port };
}

let running: Server | undefined;
afterEach(() => running?.close());

test('an upload that the browser drops half way leaves the server up', async () => {
	const { server, port } = await collector();
	running = server;
	const failures: unknown[] = [];
	const record = (reason: unknown) => failures.push(reason);
	process.on('unhandledRejection', record);
	try {
		// The server reads the start of a report, then the page goes away with the rest.
		const dropped = new Promise<void>((resolve) =>
			server.once('request', (req) => req.on('close', resolve)),
		);
		const upload = request({
			host: '127.0.0.1',
			port,
			method: 'POST',
			path: '/__null3d/runs/abort-test/device/item',
			headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' },
		});
		upload.on('error', () => {});
		upload.write('{"ok": tru');
		await new Promise((resolve) => setTimeout(resolve, 50));
		upload.destroy();
		await dropped;
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(failures).toEqual([]);
		const answer = await fetch(`http://127.0.0.1:${port}/__null3d/runs/current`);
		expect(answer.status).toBe(200);
	} finally {
		process.off('unhandledRejection', record);
	}
});
