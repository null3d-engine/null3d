// The report collector on a server of its own. A page can leave while its report is on the way, as
// when a test ends or the startup tool closes its tab, and the server must stay up.
import { afterAll, beforeAll, expect, test } from 'bun:test';
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

let server: Server;
let port = 0;

beforeAll(async () => {
	const routes: [string, Handler][] = [];
	collectorRoutes({
		use: (path: string, handle: Handler) => routes.push([path, handle]),
	} as unknown as Connect.Server);
	// Each route sees the address past its prefix, as on Vite's servers.
	server = createServer((req, res) => {
		const route = routes.find(([path]) => req.url?.startsWith(path));
		if (!route) {
			res.statusCode = 404;
			return res.end();
		}
		req.url = (req.url ?? '').slice(route[0].length) || '/';
		route[1](req, res, () => {});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	port = (server.address() as AddressInfo).port;
});

afterAll(() => server.close());

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts an upload of a report, sends part of it, and drops the connection. */
async function dropUpload(path: string): Promise<void> {
	const closed = new Promise<void>((resolve) =>
		server.once('request', (req: IncomingMessage) => req.on('close', resolve)),
	);
	const upload = request({
		host: '127.0.0.1',
		port,
		method: 'POST',
		path,
		headers: { 'Content-Type': 'application/json', 'Content-Length': '1000' },
	});
	upload.on('error', () => {});
	upload.write('{"ok": tru');
	await wait(50);
	upload.destroy();
	await closed;
	await wait(50);
}

test('a report upload that the page drops half way leaves the server up', async () => {
	const failures: unknown[] = [];
	const record = (reason: unknown) => failures.push(reason);
	process.on('unhandledRejection', record);
	try {
		// A test page's report, as the startup tool's pages send it, and a device run's result.
		await dropUpload('/__null3d/report?name=dropped-upload');
		await dropUpload('/__null3d/runs/dropped-upload/device/item');
		expect(failures).toEqual([]);
		const answer = await fetch(`http://127.0.0.1:${port}/__null3d/runs/current`);
		expect(answer.status).toBe(200);
	} finally {
		process.off('unhandledRejection', record);
	}
});
