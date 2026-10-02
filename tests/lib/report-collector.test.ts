// The report collector on a server of its own. A page can leave while its report is on the way, as
// when a test ends or the startup tool closes its tab, and the server must stay up. A runner page
// that a newer one replaced can still send results, and the collector must refuse them.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import {
	createServer,
	type IncomingMessage,
	request,
	type Server,
	type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { Connect } from 'vite';
import { collectorRoutes, RUNS_DIR } from './report-collector.ts';

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

test("a replaced runner page's late result is refused and leaves the newer page's result", async () => {
	const run = `claim-test-${process.pid}`;
	const runs = `http://127.0.0.1:${port}/__null3d/runs/${run}/mac-safari`;
	const post = (path: string, body?: unknown) =>
		fetch(`${runs}${path}`, {
			method: 'POST',
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	try {
		expect((await post('?page=old')).status).toBe(204);
		expect((await post('/item?page=old', { ok: true, from: 'old' })).status).toBe(204);
		// A new runner page takes over and runs the item again; the old one, still running hidden,
		// finishes it later.
		expect((await post('?page=new')).status).toBe(204);
		expect((await post('/item?page=new', { ok: true, from: 'new' })).status).toBe(204);
		expect((await post('/item?page=old', { ok: false, from: 'old' })).status).toBe(409);
		const stored = JSON.parse(readFileSync(join(RUNS_DIR, run, 'mac-safari/item.json'), 'utf8'));
		expect(stored).toMatchObject({ ok: true, from: 'new' });
		expect((await post('/item?page=bad/name', { ok: true })).status).toBe(400);
	} finally {
		rmSync(join(RUNS_DIR, run), { recursive: true, force: true });
	}
});

test('a runner page can list the results and records that its runner stored so far', async () => {
	const run = `list-test-${process.pid}`;
	const runs = `http://127.0.0.1:${port}/__null3d/runs/${run}/ipad-safari`;
	try {
		expect(await (await fetch(runs)).json()).toEqual([]);
		await fetch(`${runs}?page=one`, { method: 'POST' });
		await fetch(`${runs}/device?page=one`, { method: 'POST', body: '{}' });
		await fetch(`${runs}/grow.progress`, { method: 'POST', body: '{"livedMiB":64}' });
		const names = (await (await fetch(runs)).json()) as string[];
		expect(names.sort()).toEqual(['device', 'grow.progress']);
	} finally {
		rmSync(join(RUNS_DIR, run), { recursive: true, force: true });
	}
});
