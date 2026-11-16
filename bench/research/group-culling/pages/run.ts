// Runs the desert and Bistro pages in Chrome for Testing: starts the server, opens each page in a
// fresh parked window, waits for its result and writes every result to the file that MESHLETS_OUT
// names, or results/results.json beside this folder. Each argument is a
// page address relative to the server, such as `three.html?view=walk`; without arguments it runs
// the standard set. `--runs <n>` runs each page that many times. `--uncapped` starts Chrome without
// the display's frame cap, so each page draws as fast as it can and the time between frames measures
// both engines by one method.
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { GPU_TIMING_ARGS } from '../../../../packages/cli/src/browser.js';
import {
	displayRateCheck,
	launchInWindow,
	newParkedPage,
} from '../../../../tests/lib/app-window.ts';
import { chromeForTesting } from '../../../../tests/lib/chrome-for-testing.ts';

const STANDARD = [
	'three.html?view=walk',
	'null3d.html?view=walk',
	'three.html?view=aerial',
	'null3d.html?view=aerial',
];

const args = process.argv.slice(2);
const runsAt = args.indexOf('--runs');
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 1;
const pages = args.filter((a, i) => !a.startsWith('--') && (runsAt < 0 || i !== runsAt + 1));
const uncapped = args.includes('--uncapped');
const UNCAPPED_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const port = Number(process.env.MESHLETS_PORT ?? 6490);
const out = process.env.MESHLETS_OUT ?? join(import.meta.dirname, '../results/results.json');

const server = Bun.spawn(['bun', join(import.meta.dirname, 'serve.ts')], {
	env: { ...process.env, MESHLETS_PORT: String(port) },
	stdout: 'inherit',
	stderr: 'inherit',
});
await new Promise((resolve) => setTimeout(resolve, 500));

const browser = await launchInWindow({
	executablePath: chromeForTesting().executablePath,
	args: [...GPU_TIMING_ARGS, ...(uncapped ? UNCAPPED_ARGS : [])],
});
const results: object[] = [];
const ATTEMPTS = Number(process.env.MESHLETS_ATTEMPTS ?? 3);
let invalidPages = 0;
try {
	for (let run = 0; run < runs; run++) {
		for (const address of pages.length > 0 ? pages : STANDARD) {
			// A page whose engine reported any problem, such as a GPU command the browser refused, may
			// have dropped frames, so its figures are marked invalid and the page runs again, up to
			// `MESHLETS_ATTEMPTS` times in all.
			for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
				// `MESHLETS_MAX_LOAD` holds each page until the one-minute load falls below it, for at most
				// `MESHLETS_QUIET_WAIT_S` seconds, so a timed page does not share the machine with builds.
				const maxLoad = Number(process.env.MESHLETS_MAX_LOAD ?? Infinity);
				const quietBy = Date.now() + Number(process.env.MESHLETS_QUIET_WAIT_S ?? 1800) * 1000;
				while (loadavg()[0] > maxLoad && Date.now() < quietBy)
					await new Promise((resolve) => setTimeout(resolve, 15_000));
				const page = await newParkedPage(browser, { viewport: { width: 1000, height: 600 } });
				const errors: string[] = [];
				page.on('pageerror', (e) => errors.push(String(e)));
				page.on('console', (m) => {
					if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 3000));
				});
				const displayProblem = uncapped ? undefined : await displayRateCheck(page);
				const started = Date.now();
				const loadBefore = loadavg()[0];
				await page.goto(`http://localhost:${port}/${address}`);
				// A page with a fixed camera gets a picture a few seconds after its first frame, to check by eye
				// that both engines draw the same scene.
				if (address.includes('hold=')) {
					await page.waitForFunction(() => (globalThis as { __ready?: boolean }).__ready, null, {
						timeout: 15 * 60_000,
						polling: 500,
					});
					await new Promise((resolve) => setTimeout(resolve, 4000));
					const name = address.replace(/[^a-z0-9]+/gi, '-');
					await page.locator('canvas').screenshot({
						path: join(
							import.meta.dirname,
							`../../../../target/group-culling/results/shot-${name}.png`,
						),
					});
				}
				// A page that gives no result in time is recorded with its status text and problems, and the
				// run goes on to the next page.
				const finished = await page
					.waitForFunction(
						// The desert's pages publish `__result`, the repository's test pages `__null3dResult`.
						() => {
							const g = globalThis as { __result?: object; __null3dResult?: object };
							return g.__result ?? g.__null3dResult;
						},
						null,
						{
							timeout: Number(process.env.MESHLETS_TIMEOUT_S ?? 900) * 1000,
							polling: 1000,
						},
					)
					.then(
						() => true,
						() => false,
					);
				const result = finished
					? await page.evaluate(() => {
							const g = globalThis as { __result?: object; __null3dResult?: object };
							return g.__result ?? g.__null3dResult;
						})
					: {
							error: `no result in time; status: ${await page.evaluate(() => document.querySelector('#status')?.textContent ?? '')}`,
						};
				const invalid = errors.length > 0 || 'error' in (result as object);
				if (invalid) invalidPages++;
				const record = {
					address,
					run,
					attempt,
					invalid,
					uncapped,
					startedAt: new Date(started).toISOString(),
					wallSeconds: (Date.now() - started) / 1000,
					load: { before: loadBefore, after: loadavg()[0] },
					displayProblem,
					...result,
					problems: errors.slice(0, 40),
				};
				results.push(record);
				writeFileSync(out, JSON.stringify(results, null, '\t'));
				const r = record as Record<string, unknown>;
				console.log(
					`${address} run ${run}${invalid ? ` INVALID (attempt ${attempt + 1}): ${errors[0]?.slice(0, 160) ?? r.error}` : ''}: ${r.error ? `ERROR ${r.error}` : `gpu ${r.gpuMs?.median?.toFixed(2)} ms, interval ${r.intervalMs?.median?.toFixed(2)} ms, fps ${r.presentedFps?.toFixed(1)}, triangles ${Math.round(r.triangles?.median ?? 0)}, draws ${Math.round(r.drawCalls?.median ?? 0)}, path ${r.directDraws === undefined ? 'n/a' : r.directDraws ? 'direct' : 'indirect'}, drawn ${r.drawn?.width}x${r.drawn?.height}, first frame ${(r.firstFrameMs / 1000).toFixed(1)} s`}, started ${new Date(started).toTimeString().slice(0, 8)}, load ${loadBefore.toFixed(1)} to ${loadavg()[0].toFixed(1)}`,
				);
				await page.close();
				if (!invalid) break;
			}
		}
	}
} finally {
	await browser.close();
	server.kill();
}
console.log(
	`${invalidPages} page runs were invalid, from an engine problem or no result, and ran again`,
);
console.log(`results in ${out}`);
