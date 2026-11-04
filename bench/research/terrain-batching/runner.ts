// Visits the built Island view pages in rotated order in one parked Chrome for Testing window, and
// keeps every visit's result with the load and the busiest apps before and after it. A visit whose
// page reports an error or no windows runs again, up to three times.
// WT=<worktree> bun tb-runner.ts <out.jsonl> <visits per folder> <folder,folder,...> <query>
import { appendFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const W = process.env.WT as string;
const [out, visitsText, foldersText, query] = process.argv.slice(2) as [
	string,
	string,
	string,
	string,
];
const visits = Number(visitsText);
const folders = foldersText.split(',');
const { GPU_TIMING_ARGS } = await import(`${W}/packages/cli/src/browser.js`);
const { launchInWindow, newParkedPage } = await import(`${W}/tests/lib/app-window.ts`);
const { chromeForTesting } = await import(`${W}/tests/lib/chrome-for-testing.ts`);
const { waitForQuietLoad } = await import(`${W}/tests/lib/cost-runs.ts`);
const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const base = 6691;
const servers = folders.map((folder, k) =>
	Bun.spawn(
		['bunx', 'vite', 'preview', '--outDir', folder, '--port', String(base + k), '--strictPort'],
		{
			cwd: W,
			stdout: 'ignore',
			stderr: 'ignore',
		},
	),
);
await new Promise((resolve) => setTimeout(resolve, 6000));
const text = async (cmd: string[]) => (await new Response(Bun.spawn(cmd).stdout).text()).trim();
const busiest = async () =>
	(await text(['ps', '-Ao', 'pcpu,comm', '-r']))
		.split('\n')
		.slice(1, 6)
		.map((line) => line.trim().replace(/\s+/, ' ').slice(0, 90));
const browser = await launchInWindow({
	...chromeForTesting(),
	args: [...GPU_TIMING_ARGS, ...UNCAPPED],
});
try {
	for (let visit = 0; visit < visits; visit++)
		for (let k = 0; k < folders.length; k++) {
			const at = (k + visit) % folders.length;
			const folder = folders[at] as string;
			for (let attempt = 0; attempt < 3; attempt++) {
				await waitForQuietLoad();
				const gated = loadavg()[0] as number;
				const appsBefore = await busiest();
				const page = await newParkedPage(browser, { viewport: { width: 1600, height: 900 } });
				const problems: string[] = [];
				page.on('pageerror', (e) => problems.push(String(e)));
				page.on('console', (m) => {
					if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text().slice(0, 300));
				});
				await page.goto(`http://localhost:${base + at}/tests/pages/island-view.html?${query}`);
				const result = await page
					.waitForFunction(
						() => (globalThis as { __null3dResult?: unknown }).__null3dResult,
						null,
						{
							timeout: 600_000,
							polling: 1000,
						},
					)
					.then(
						() => page.evaluate(() => (globalThis as { __null3dResult?: unknown }).__null3dResult),
						(e) => ({ error: String(e) }),
					);
				const appsAfter = await busiest();
				await page.close();
				const after = loadavg()[0] as number;
				const bad =
					problems.some((p) => !p.startsWith('Failed to load resource')) ||
					// biome-ignore lint/suspicious/noExplicitAny: scratch
					!(result as any)?.windows;
				appendFileSync(
					out,
					`${JSON.stringify({ folder, visit, attempt, gated, after, appsBefore, appsAfter, bad, problems, result })}\n`,
				);
				// biome-ignore lint/suspicious/noExplicitAny: scratch
				const w = ((result as any)?.windows ?? []) as any[];
				console.log(
					`${folder} visit ${visit}${bad ? ' INVALID' : ''} load ${gated.toFixed(1)}->${after.toFixed(1)}: ${w
						.map((x) => `${x.label[0]}${x.gpuMs?.median?.toFixed(2)}`)
						.join(
							' ',
						)} | ${appsBefore[0]}${bad ? ` | ${problems[0] ?? JSON.stringify(result).slice(0, 200)}` : ''}`,
				);
				if (!bad) break;
			}
		}
} finally {
	await browser.close();
	for (const server of servers) server.kill();
}
process.exit(0);
