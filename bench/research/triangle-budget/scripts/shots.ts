// Draws the desert's held views for the triangle budget study and saves each frame with its figures.
// It starts the study's dev server, opens each engine's page in Chrome for Testing in a parked
// window, and for each setting and each camera time of the plan: holds the view, saves the frame as
// a PNG file (a screenshot of the canvas), then measures one second of the held view (triangles, and GPU time). Results go to
// target/triangle-budget/shots/ (the frames) and to `--out` (default
// bench/research/triangle-budget/results/shots.json), which each page's figures extend.
//
// Usage, from the repository's root, once the desert's files are built (bun bench/lib/desert-files.ts):
//   bun bench/research/triangle-budget/scripts/shots.ts [--plan walk|walk-shadows|all] [--times 2.5,10]
//     [--engines null3d,three] [--measure 1]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { GPU_TIMING_ARGS } from '../../../../packages/cli/src/browser.js';
import { launchInWindow, newParkedPage } from '../../../../tests/lib/app-window.ts';
import { chromeForTesting } from '../../../../tests/lib/chrome-for-testing.ts';

const root = join(import.meta.dirname, '../../../..');
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? (args[i + 1] as string) : fallback;
};
const port = Number(process.env.TB_PORT ?? 6530);
const shotsDir = join(root, 'target/triangle-budget/shots');
mkdirSync(shotsDir, { recursive: true });
const out = opt('--out', join(import.meta.dirname, '../results/shots.json'));
const times = opt('--times', '2.5,7.5,12.5,17.5,22.5,27.5,32.5,37.5').split(',').map(Number);
const engines = opt('--engines', 'null3d,three').split(',');
const measureSeconds = Number(opt('--measure', '1'));
const plan = opt('--plan', 'all');
const SETTLE_SECONDS = Number(opt('--settle', '25'));
const pagePerTime = args.includes('--page-per-time');
/** Extra switches for every page, such as `occlusion=off`. */
const extra = new URLSearchParams(opt('--query', ''));
/** Only the settings named here, as lod/lodShadow pairs such as `1/1,0/0`; all of the plan's without it. */
const only = opt('--settings', '');

/** One page load: an engine, a view, its shadows and the level settings to hold in turn. */
interface Job {
	engine: 'null3d' | 'three';
	view: 'walk' | 'aerial';
	shadows: number;
	/** Each setting: the camera's threshold in pixels and the shadows' in texels; 0 draws base levels. */
	settings: [number, number][];
}

const JOBS: Record<string, Job[]> = {
	walk: [
		{
			engine: 'null3d',
			view: 'walk',
			shadows: 0,
			settings: [
				[0, 0],
				[1, 1],
				[1.5, 1],
				[2, 1],
				[3, 1],
				[4, 1],
				[0.5, 1],
			],
		},
		{
			engine: 'three',
			view: 'walk',
			shadows: 0,
			settings: [
				[0, 0],
				[1, 1],
				[2, 1],
			],
		},
	],
	'walk-shadows': [
		{
			engine: 'null3d',
			view: 'walk',
			shadows: 3,
			settings: [
				[0, 0],
				[1, 1],
				[0, 1],
				[0, 2],
				[0, 4],
				[2, 1],
				[3, 1],
				[2, 2],
				[3, 4],
				[1, 2],
				[1, 4],
			],
		},
		{
			engine: 'three',
			view: 'walk',
			shadows: 1,
			settings: [
				[0, 0],
				[1, 1],
				[0, 1],
			],
		},
	],
};
const jobs = (plan === 'all' ? Object.values(JOBS).flat() : (JOBS[plan] ?? [])).filter((j) =>
	engines.includes(j.engine),
);
if (jobs.length === 0) throw new Error(`no jobs for plan ${plan} and engines ${engines}`);

const results: Record<string, unknown>[] = existsSync(out)
	? JSON.parse(readFileSync(out, 'utf8'))
	: [];
const save = () => {
	mkdirSync(join(out, '..'), { recursive: true });
	writeFileSync(out, `${JSON.stringify(results, null, '\t')}\n`);
};

const server = Bun.spawn(
	['bunx', 'vite', '--config', join(import.meta.dirname, '../vite.config.ts')],
	{
		cwd: root,
		// The shots reach the study's server over the loopback, which is a secure origin already,
		// and their readiness poll and page loads use plain HTTP.
		env: { ...process.env, TB_PORT: String(port), NULL3D_HTTPS: '0' },
		stdout: 'inherit',
		stderr: 'inherit',
	},
);
for (let i = 0; i < 120; i++) {
	const up = await fetch(`http://localhost:${port}/`).then(
		() => true,
		() => false,
	);
	if (up) break;
	await new Promise((resolve) => setTimeout(resolve, 500));
}

const browser = await launchInWindow({
	executablePath: chromeForTesting().executablePath,
	args: [...GPU_TIMING_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
try {
	for (const job of jobs) {
		// null3D takes its thresholds when the page starts, so each of its settings opens a page;
		// three.js changes them on the page it has open.
		const settings = only
			? job.settings.filter(([a, b]) => only.split(',').includes(`${a}/${b}`))
			: job.settings;
		// null3D takes its thresholds when the page starts, so each of its settings opens a page.
		// With --page-per-time, null3D also opens a page for each camera time, which starts there.
		const groups =
			job.engine !== 'null3d'
				? [{ settings, times }]
				: pagePerTime
					? settings.flatMap((s) => times.map((t) => ({ settings: [s], times: [t] })))
					: settings.map((s) => ({ settings: [s], times }));
		for (const group of groups) {
			const page = await newParkedPage(browser, { viewport: { width: 1920, height: 1080 } });
			const problems: string[] = [];
			page.on('pageerror', (e) => problems.push(String(e)));
			page.on('console', (m) => {
				if (m.type() === 'error') problems.push(m.text().slice(0, 2000));
			});
			const query = new URLSearchParams({ view: job.view });
			if (job.shadows > 0) query.set('shadows', String(job.shadows));
			if (job.engine === 'null3d') {
				query.set('lod', String(group.settings[0]?.[0]));
				query.set('lodShadow', String(group.settings[0]?.[1]));
				if (pagePerTime) query.set('at', String(group.times[0]));
			}
			for (const [k, v] of extra) query.set(k, v);
			const address = `http://localhost:${port}/bench/research/triangle-budget/pages/${job.engine}.html?${query}`;
			console.log(`open ${address}`);
			await page.goto(address);
			await page.waitForFunction(() => (globalThis as { __tbReady?: boolean }).__tbReady, null, {
				timeout: 20 * 60_000,
				polling: 1000,
			});
			// The desert's ground finishes loading after the first frame: its tree of patches
			// arrives on the job workers. A frame taken sooner shows the props over the sky.
			await new Promise((resolve) => setTimeout(resolve, SETTLE_SECONDS * 1000));
			for (const [lod, lodShadow] of group.settings)
				for (const t of group.times) {
					await page.evaluate(
						([t, lod, lodShadow]) =>
							(
								globalThis as unknown as { __tb: { set: (...a: number[]) => Promise<void> } }
							).__tb.set(t as number, lod as number, lodShadow as number),
						[t, lod, lodShadow],
					);
					// The canvas as the browser shows it, read the same way for both engines. The engine's
					// own capture of a held frame leaves the desert's ground out, which a screenshot of the
					// same frame shows.
					const png = await page.locator('canvas').first().screenshot();
					const tag = extra.toString() ? `-${extra.toString().replace(/[^a-z0-9]+/gi, '-')}` : '';
					const name = `${job.engine}-${job.view}-s${job.shadows}-lod${lod}-sh${lodShadow}-t${t}${tag}.png`;
					writeFileSync(join(shotsDir, name), png);
					const figures = await page.evaluate(
						(seconds) =>
							(
								globalThis as unknown as {
									__tb: { measure: (s: number) => Promise<Record<string, unknown>> };
								}
							).__tb.measure(seconds),
						measureSeconds,
					);
					const record = {
						engine: job.engine,
						view: job.view,
						shadows: job.shadows,
						lod,
						lodShadow,
						t,
						shot: name,
						variant: extra.toString(),
						load: loadavg()[0],
						problems: [...problems],
						...figures,
					};
					problems.length = 0;
					const at = results.findIndex((r) => r.shot === name);
					if (at >= 0) results[at] = record;
					else results.push(record);
					save();
					console.log(JSON.stringify(record));
				}
			await page.close();
		}
	}
} finally {
	await browser.close();
	server.kill();
}
