import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Where test pages' reports land, one JSON line per report. */
export const REPORT_DIR = join(import.meta.dirname, '../../target/reports');
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

/**
 * A dev-server endpoint that stores reports from test pages. Browsers that Playwright cannot
 * drive, such as Safari on a phone, open a test page and post their results here.
 */
export function reportCollector(): Plugin {
	return {
		name: 'sokko3d-report-collector',
		configureServer(server) {
			server.middlewares.use('/__sokko3d/report', (req, res) => {
				if (req.method !== 'POST') {
					res.statusCode = 405;
					res.end();
					return;
				}
				const name =
					new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? 'report';
				if (!/^[a-z0-9-]+$/.test(name)) {
					res.statusCode = 400;
					res.end('bad report name');
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				req.on('data', (chunk: Buffer) => {
					size += chunk.length;
					if (size <= MAX_REPORT_BYTES) chunks.push(chunk);
				});
				req.on('end', () => {
					if (size > MAX_REPORT_BYTES) {
						res.statusCode = 413;
						res.end();
						return;
					}
					mkdirSync(REPORT_DIR, { recursive: true });
					const line = JSON.stringify({
						receivedAt: new Date().toISOString(),
						...JSON.parse(Buffer.concat(chunks).toString('utf8')),
					});
					appendFileSync(join(REPORT_DIR, `${name}.jsonl`), `${line}\n`);
					res.statusCode = 204;
					res.end();
				});
			});
		},
	};
}
