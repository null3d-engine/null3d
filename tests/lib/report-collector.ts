import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';

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

function send(res: ServerResponse, status: number, body?: string): void {
	res.statusCode = status;
	if (body !== undefined) res.setHeader('Content-Type', 'application/json');
	res.end(body);
}

/** Stores a POSTed JSON body with the time it arrived, through `store`. */
async function receive(
	req: IncomingMessage,
	res: ServerResponse,
	store: (json: string) => void,
): Promise<void> {
	if (req.method !== 'POST') return send(res, 405);
	const body = await readBody(req);
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
 * Dev-server endpoints for results from browsers that Playwright cannot drive, such as Safari on a
 * tablet:
 * - `POST /__sokko3d/report?name=` appends a test page's report to one JSON-lines file per page.
 * - `GET /__sokko3d/runs/current` tells waiting runner pages which run to start.
 * - `GET /__sokko3d/runs/<run>/plan` returns a run's list of pages.
 * - `POST /__sokko3d/runs/<run>/<device>/<name>` stores one result of a device as its own file,
 *   and `GET` on the same path reads it back.
 */
export function reportCollector(): Plugin {
	return {
		name: 'sokko3d-report-collector',
		configureServer(server) {
			server.middlewares.use('/__sokko3d/report', (req, res) => {
				const name =
					new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? 'report';
				if (!NAME.test(name)) return send(res, 400);
				void receive(req, res, (json) => {
					mkdirSync(REPORT_DIR, { recursive: true });
					appendFileSync(join(REPORT_DIR, `${name}.jsonl`), `${json}\n`);
				});
			});
			server.middlewares.use('/__sokko3d/runs', (req, res) => {
				const parts = new URL(req.url ?? '/', 'http://localhost').pathname
					.split('/')
					.filter(Boolean);
				if (parts.length === 1 && parts[0] === 'current') {
					const current = existsSync(CURRENT_RUN_FILE)
						? readFileSync(CURRENT_RUN_FILE, 'utf8')
						: '{}';
					return send(res, 200, current);
				}
				if (!parts.every((part) => NAME.test(part))) return send(res, 400);
				const [run, device, name] = parts as [string, string?, string?];
				if (parts.length === 2 && device === 'plan') {
					const plan = join(RUNS_DIR, run, 'plan.json');
					return existsSync(plan) ? send(res, 200, readFileSync(plan, 'utf8')) : send(res, 404);
				}
				if (parts.length !== 3 || !device || !name) return send(res, 404);
				if (req.method === 'GET') {
					const file = join(RUNS_DIR, run, device, `${name}.json`);
					return existsSync(file) ? send(res, 200, readFileSync(file, 'utf8')) : send(res, 404);
				}
				void receive(req, res, (json) => {
					mkdirSync(join(RUNS_DIR, run, device), { recursive: true });
					writeFileSync(join(RUNS_DIR, run, device, `${name}.json`), json);
				});
			});
		},
	};
}
