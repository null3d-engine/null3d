// A full picture run asks its page server for every test page in the repository, and on this Mac the
// server reached 3,542 MB of resident memory before the set was done. At Node's default heap limit it
// died partway through, and each page after the death failed as E1410 with a refused connection,
// which reads as a picture or a timeout rather than as a server that is gone. So the servers are given
// a heap limit, and this test holds that limit above the measured peak, because a test that starts
// after the death cannot catch it.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const CONFIG = 'tests/playwright.config.ts';

/** The dev server's resident peak at 1,915 pages, in megabytes (2 November 2026). */
const MEASURED_PEAK_MB = 3542;

describe('the picture run page servers', () => {
	const text = readFileSync(join(ROOT, CONFIG), 'utf8');

	it('are given a heap limit above the measured peak', () => {
		const match = /--max-old-space-size=(\d+)/.exec(text);
		expect(match, `${CONFIG} sets no --max-old-space-size`).not.toBeNull();
		const megabytes = Number(match?.[1]);
		expect(
			megabytes,
			`the limit is ${megabytes} MB and the dev server measured ${MEASURED_PEAK_MB} MB at 1,915 pages`,
		).toBeGreaterThan(MEASURED_PEAK_MB);
	});

	it('pass that limit to both servers', () => {
		const uses = text.match(/env: PAGE_SERVER_HEAP_ENV/g) ?? [];
		expect(
			uses.length,
			`${CONFIG} gives the heap limit to ${uses.length} of its two servers; a preview without it can die the same way`,
		).toBe(2);
	});
});
