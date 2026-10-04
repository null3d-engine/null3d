// Prototype L1 on this Mac: runs every variant of the room's generator page in the installed
// Google Chrome on the Mac's GPU, through a dev server that already runs on NULL3D_PORT, and
// prints a table. Each variant runs `--rounds` times, in turns, so the rounds share the Mac's load.
// The raw results go to target/prefilter/.
//   NULL3D_PORT=14573 bun tests/prefilter-cost.ts [--rounds 3] [--only id,id] [--switches a=b&c=d]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadResult } from './lib/page-result.ts';
import { prefilterLine as line, prefilterVariants } from './lib/prefilter-variants.ts';
import { HTTP_PORT, REPO_ROOT } from './lib/server.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
const rounds = Number(option('--rounds') ?? '1');
const only = option('--only')?.split(',');
const extra = option('--switches');
const variants = prefilterVariants().filter((v) => !only || only.includes(v.id));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results: Record<string, unknown[]> = {};
for (let round = 0; round < rounds; round++)
	for (const variant of variants) {
		// A fresh browser context per page, so no page inherits another's GPU state.
		const context = await browser.newContext();
		const page = await context.newPage();
		const query = [...variant.switches, ...(extra ? [extra] : [])].join('&');
		const result = await loadResult(
			page,
			`http://localhost:${HTTP_PORT}/tests/pages/prefilter-cost.html?${query}`,
			120_000,
		);
		await context.close();
		const list = results[variant.id] ?? [];
		list.push(result);
		results[variant.id] = list;
		console.log(`${variant.id} ${line(result as Record<string, unknown>)}`);
	}
await browser.close();
const dir = join(REPO_ROOT, 'target/prefilter');
mkdirSync(dir, { recursive: true });
const file = join(dir, `mac-chrome-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(results, null, '\t'));
console.log(`results: ${file}`);
