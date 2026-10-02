import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';

/** Where test pages' reports land, one JSON line per report. */
export const REPORT_DIR = join(import.meta.dirname, '../../target/reports');
/** Where runs of the runner page land: a plan per run, and one file per device and item. */
export const RUNS_DIR = join(import.meta.dirname, '../../target/runs');
/** The run that waiting runner pages should start, and which of them may start it now. */
export const CURRENT_RUN_FILE = join(RUNS_DIR, 'current.json');

const MAX_REPORT_BYTES = 64 * 1024 * 1024;
/** Names of runs, devices and items: they become file names, so nothing that could leave the folder. */
const NAME = /^[a-z0-9][a-z0-9._-]*$/;

function readBody(req: IncomingMessage): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (chunk: Buffer) => {
			size += chunk.length;
			if (size <= MAX_REPORT_BYTES) chunks.push(chunk);
		});
		req.on('end', () =>
			resolve(size > MAX_REPORT_BYTES ? undefined : Buffer.concat(chunks).toString('utf8')),
		);
		req.on('error', reject);
	});
}

/** Ends a response with its status, and with a body of JSON text when there is one. */
export function send(res: ServerResponse, status: number, body?: string): void {
	res.statusCode = status;
	if (body !== undefined) res.setHeader('Content-Type', 'application/json');
	res.end(body);
}

/**
 * Stores a POSTed JSON body with the time it arrived, through `store`. A body that never arrives
 * whole, as when a page navigates away during its upload, stores nothing: the connection is gone,
 * so no answer can reach the page.
 */
async function receive(
	req: IncomingMessage,
	res: ServerResponse,
	store: (json: string) => void,
): Promise<void> {
	if (req.method !== 'POST') return send(res, 405);
	let body: string | undefined;
	try {
		body = await readBody(req);
	} catch {
		return;
	}
	if (body === undefined) return send(res, 413);
	let report: unknown;
	try {
		report = JSON.parse(body);
	} catch {
		return send(res, 400);
	}
	store(JSON.stringify({ receivedAt: new Date().toISOString(), ...(report as object) }));
	send(res, 204);
}

/**
 * The file that names the runner page which claimed a run's device last. Its name starts with a dot,
 * which no item's name can, so it never stands for a result.
 */
const claimPath = (run: string, device: string) => join(RUNS_DIR, run, device, '.runner-page');

/** Whether `page` may store a run's device's results: no runner page claimed it, or `page` did last. */
function holdsClaim(run: string, device: string, page: string): boolean {
	const claim = claimPath(run, device);
	return !existsSync(claim) || readFileSync(claim, 'utf8') === page;
}

/**
 * Endpoints for results from browsers that Playwright cannot drive, such as Safari on a tablet, on
 * the dev server and on `vite preview`, which serves the production builds:
 * - `POST /__null3d/report?name=` appends a test page's report to one JSON-lines file per page.
 * - `GET /__null3d/runs/current` tells waiting runner pages which run to start.
 * - `GET /__null3d/runs/<run>/plan` returns a run's list of pages.
 * - `POST /__null3d/runs/<run>/<device>?page=<page>` claims a run's device for the runner page that
 *   calls itself `page`, as each runner page does when it starts.
 * - `GET /__null3d/runs/<run>/<device>` lists the names of a device's results and records so far,
 *   where a runner page that the browser reloaded finds where to go on.
 * - `POST /__null3d/runs/<run>/<device>/<name>?page=<page>` stores one result of a device as its
 *   own file, and `GET` on the same path reads it back. A result from a runner page other than the
 *   one that claimed the device last is refused with 409 and stores nothing: a runner page that the
 *   runner tool replaced can still be running, hidden behind the new one, and its late results
 *   would overwrite the new page's.
 */
export function collectorRoutes(middlewares: Connect.Server): void {
	middlewares.use('/__null3d/report', (req, res) => {
		const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? 'report';
		if (!NAME.test(name)) return send(res, 400);
		void receive(req, res, (json) => {
			mkdirSync(REPORT_DIR, { recursive: true });
			appendFileSync(join(REPORT_DIR, `${name}.jsonl`), `${json}\n`);
		});
	});
	middlewares.use('/__null3d/runs', (req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const parts = url.pathname.split('/').filter(Boolean);
		const page = url.searchParams.get('page');
		if (parts.length === 1 && parts[0] === 'current') {
			const current = existsSync(CURRENT_RUN_FILE) ? readFileSync(CURRENT_RUN_FILE, 'utf8') : '{}';
			return send(res, 200, current);
		}
		if (!parts.every((part) => NAME.test(part)) || (page !== null && !NAME.test(page)))
			return send(res, 400);
		const [run, device, name] = parts as [string, string?, string?];
		if (parts.length === 2 && device === 'plan') {
			const plan = join(RUNS_DIR, run, 'plan.json');
			return existsSync(plan) ? send(res, 200, readFileSync(plan, 'utf8')) : send(res, 404);
		}
		if (parts.length === 2 && device && req.method === 'GET') {
			const dir = join(RUNS_DIR, run, device);
			const names = existsSync(dir)
				? readdirSync(dir)
						.filter((file) => file.endsWith('.json'))
						.map((file) => file.slice(0, -'.json'.length))
				: [];
			return send(res, 200, JSON.stringify(names));
		}
		if (parts.length === 2 && device && page !== null && req.method === 'POST') {
			mkdirSync(join(RUNS_DIR, run, device), { recursive: true });
			writeFileSync(claimPath(run, device), page);
			return send(res, 204);
		}
		if (parts.length !== 3 || !device || !name) return send(res, 404);
		if (req.method === 'GET') {
			const file = join(RUNS_DIR, run, device, `${name}.json`);
			return existsSync(file) ? send(res, 200, readFileSync(file, 'utf8')) : send(res, 404);
		}
		if (page !== null && !holdsClaim(run, device, page)) return send(res, 409);
		void receive(req, res, (json) => {
			mkdirSync(join(RUNS_DIR, run, device), { recursive: true });
			writeFileSync(join(RUNS_DIR, run, device, `${name}.json`), json);
		});
	});
}

/** The collector's endpoints on the dev server and on `vite preview`. */
export function reportCollector(): Plugin {
	return {
		name: 'null3d-report-collector',
		configureServer(server) {
			collectorRoutes(server.middlewares);
		},
		configurePreviewServer(server) {
			collectorRoutes(server.middlewares);
		},
	};
}
