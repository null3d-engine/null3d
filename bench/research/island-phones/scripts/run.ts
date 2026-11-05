// Runs the phones study's page on this Mac in Chrome for Testing, in a window parked past the
// screen's edge, and saves each load's result with the machine's load at both ends. It builds the
// page for production first, holds the quiet-window marker while it measures, and waits for a
// 1-minute load under the study's limit before each load.
// Run from the repository's root:
//   bun bench/research/island-phones/scripts/run.ts <plan.json> <out folder> [--rounds n] [--no-build] [--uncapped]
// A plan is a list of { "name", "query" } items; `query` is the page's switches without the `?`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { GPU_TIMING_ARGS } from '../../../../packages/cli/src/browser.js';
import {
	displayRateCheck,
	launchInWindow,
	newParkedPage,
} from '../../../../tests/lib/app-window.ts';
import { chromeForTesting } from '../../../../tests/lib/chrome-for-testing.ts';
import { startPreview } from '../../../../tests/lib/server.ts';
import { quietFile, refuseInQuietWindow } from '../../../../tools/lib/quiet-window.ts';

const args = process.argv.slice(2);
const [planFile, outDir] = args as [string, string];
const rounds = Number(args[args.indexOf('--rounds') + 1] || 1) || 1;
const build = !args.includes('--no-build');
// Without the frame cap the page draws as fast as it can, so the GPU never idles and keeps its full
// clock: a capped light frame lets the Mac's GPU slow down, which hides what a part of the frame costs.
const UNCAPPED_ARGS = args.includes('--uncapped')
	? ['--disable-gpu-vsync', '--disable-frame-rate-limit']
	: [];
const root = join(import.meta.dirname, '../../../..');
const port = Number(process.env.IP_PORT ?? 6571);
const QUIET_LIMIT = 6;
const LOAD_WAIT_MS = 10 * 60_000;
const PAGE_LIMIT_MS = 12 * 60_000;
const PAGE = 'bench/research/island-phones/pages/island.html';

const plan = JSON.parse(readFileSync(planFile, 'utf8')) as { name: string; query: string }[];
mkdirSync(outDir, { recursive: true });
refuseInQuietWindow('The phones study');
if (build)
	execFileSync(
		'bunx',
		['vite', 'build', '--config', 'bench/research/island-phones/vite.build.config.ts'],
		{
			cwd: root,
			stdio: 'inherit',
		},
	);

const marker = quietFile();
const until = new Date(Date.now() + plan.length * rounds * 4 * 60_000 + 10 * 60_000);
const hhmm = `${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}`;
writeFileSync(marker, `island-phones study (bench/research/island-phones), until about ${hhmm}\n`);
const clear = () => rmSync(marker, { force: true });
process.on('exit', clear);
process.on('SIGINT', () => process.exit(130));

const server = await startPreview(join(root, 'target/island-phones'), port, `/${PAGE}`, root);
const browser = await launchInWindow({
	executablePath: chromeForTesting().executablePath,
	args: [...GPU_TIMING_ARGS, ...UNCAPPED_ARGS],
});

async function quiet(): Promise<number> {
	const start = Date.now();
	while ((loadavg()[0] as number) >= QUIET_LIMIT) {
		if (Date.now() - start > LOAD_WAIT_MS)
			throw new Error(`load stayed at ${loadavg()[0]} for 10 minutes`);
		await new Promise((r) => setTimeout(r, 5000));
	}
	return loadavg()[0] as number;
}

try {
	for (let round = 1; round <= rounds; round++)
		for (const item of plan) {
			const w = Number(new URLSearchParams(item.query).get('w') ?? 384);
			const h = Number(new URLSearchParams(item.query).get('h') ?? 832);
			const loadBefore = await quiet();
			const page = await newParkedPage(browser, { viewport: { width: w + 20, height: h + 20 } });
			const errors: string[] = [];
			page.on('pageerror', (e) => errors.push(String(e)));
			page.on('console', (m) => {
				if (m.type() === 'error') errors.push(m.text().slice(0, 400));
			});
			const display = await displayRateCheck(page).catch((e) => `display check failed: ${e}`);
			const started = Date.now();
			await page.goto(`http://localhost:${port}/${PAGE}?${item.query}`);
			const result = await page.waitForFunction(
				() => (window as { __null3dResult?: unknown }).__null3dResult,
				null,
				{
					timeout: PAGE_LIMIT_MS,
					polling: 1000,
				},
			);
			const value = await result.jsonValue();
			const loadAfter = loadavg()[0] as number;
			await page.context().close();
			const record = {
				name: item.name,
				round,
				query: item.query,
				loadBefore,
				loadAfter,
				seconds: (Date.now() - started) / 1000,
				displayProblem: display ?? null,
				errors,
				result: value,
			};
			writeFileSync(
				join(outDir, `${item.name}-${round}.json`),
				`${JSON.stringify(record, null, '\t')}\n`,
			);
			console.log(
				`${item.name} round ${round}: load ${loadBefore.toFixed(1)} -> ${loadAfter.toFixed(1)}, ${errors.length} errors`,
			);
		}
} finally {
	await browser.close();
	await server.stop();
	clear();
}
