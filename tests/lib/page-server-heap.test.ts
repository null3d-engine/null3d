// A full picture run asks its page server for every test page in the repository, and on this Mac the
// server reached 3,542 MB of resident memory before the set was done. At Node's default heap limit it
// died partway through, and each page after the death failed as E1410 with a refused connection,
// which reads as a picture or a timeout rather than as a server that is gone. So the servers are given
// a heap limit, and this test holds that limit above the measured peak, because a test that starts
// after the death cannot catch it.
//
// The limit lives with the code that starts a server, so every caller gets it: a review round starts
// its own server and died the same way before the limit was moved there.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const SOURCE = 'tests/lib/server.ts';

/** The dev server's resident peak at 1,915 pages, in megabytes, as measured on the Mac. */
const MEASURED_PEAK_MB = 3542;

describe('every page server', () => {
	const text = readFileSync(join(ROOT, SOURCE), 'utf8');

	it('is given a heap limit above the measured peak', () => {
		const match = /--max-old-space-size=(\d+)/.exec(text);
		expect(match, `${SOURCE} sets no --max-old-space-size`).not.toBeNull();
		const megabytes = Number(match?.[1]);
		expect(
			megabytes,
			`the limit is ${megabytes} MB and the dev server measured ${MEASURED_PEAK_MB} MB at 1,915 pages`,
		).toBeGreaterThan(MEASURED_PEAK_MB);
	});

	it('takes that limit however the caller starts it', () => {
		expect(
			text.includes('...SERVER_HEAP_ENV'),
			`${SOURCE} starts a server without the heap limit in its environment`,
		).toBe(true);
	});
});
