import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { REPO_ROOT } from '../lib/server.ts';

test('the dev server refuses build output and git files, and serves the pages', async ({
	request,
}) => {
	mkdirSync(join(REPO_ROOT, 'target'), { recursive: true });
	writeFileSync(join(REPO_ROOT, 'target/deny-check.txt'), 'not for the network');
	for (const path of ['/target/deny-check.txt', '/.git/config', '/.git/HEAD?raw']) {
		expect((await request.get(path)).status(), path).toBe(403);
	}
	expect((await request.get('/tests/pages/index.html')).status()).toBe(200);
	expect((await request.get('/bench/pages/index.html')).status()).toBe(200);
	const bare = await request.get('/', { maxRedirects: 0 });
	expect(bare.status()).toBe(302);
	expect(bare.headers().location).toBe('/tests/pages/');
});
